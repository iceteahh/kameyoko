import './styles.css';
import { Sfx } from './audio/sfx';
import { CONFIG } from './config';
import { openCamera } from './camera';
import { Recorder } from './debug/recorder';
import { Demo } from './demo/demo';
import { Game, type GameEvent, type PlayerCtx } from './game/game';
import { analyzePose } from './gesture/analyze';
import { GestureController, type GestureEvent } from './gesture/controller';
import { Layout } from './layout';
import { clamp } from './math';
import { Effects } from './render/fx';
import { Overlay } from './render/overlay';
import { Renderer } from './render/renderer';
import { createDetector, type Detector, type PoseModel } from './tracking/detector';
import { Tracker } from './tracking/tracker';
import type { PlayerId } from './types';
import { Hud } from './ui/hud';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>('video');
const startScreen = $('start');
const statusEl = $('status');
const hudRoot = $('hud');

const layout = new Layout();
const renderer = new Renderer($<HTMLCanvasElement>('fx'), layout);
const effects = new Effects(renderer.scene, layout, renderer.pixelRatio);
const overlay = new Overlay($<HTMLCanvasElement>('overlay'), layout);
const hud = new Hud(hudRoot, layout);
const sfx = new Sfx();
const tracker = new Tracker();
const ctrls = [new GestureController(), new GestureController()] as const;
const game = new Game(layout);
const recorder = new Recorder();

let detector: Detector | null = null;
let demo: Demo | null = null;
let running = false;
let paused = false;
let lastFrame = 0;
let lastVideoTime = -1;
let fps = 60;
const wasPresent = [false, false];

function resize() {
  layout.update(window.innerWidth, window.innerHeight, video.videoWidth || 1280, video.videoHeight || 720);
  renderer.resize();
  overlay.resize();
}
window.addEventListener('resize', resize);
resize();

function setStatus(msg: string, error = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', error);
}

async function start(mode: 'camera' | 'demo') {
  sfx.init();
  const buttons = startScreen.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    if (mode === 'camera') {
      setStatus('Requesting camera…');
      await openCamera(video);
      const model = ($<HTMLSelectElement>('model').value || 'full') as PoseModel;
      const hands = $<HTMLInputElement>('hands').checked;
      detector = await createDetector({ model, hands, onStatus: setStatus });
      renderer.setVideo(video);
      demo = null;
    } else {
      const solo = new URLSearchParams(location.search).get('demo') === 'solo';
      demo = new Demo(simTime, 16 / 9, solo);
      if (solo) tracker.maxPlayers = 1;
      renderer.setVideo(null);
    }
    resize();
    startScreen.classList.add('hidden');
    hudRoot.classList.remove('hidden');
    if (!running) {
      running = true;
      lastFrame = performance.now();
      requestAnimationFrame(frame);
    }
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(
      msg.includes('Permission') || msg.includes('NotAllowed')
        ? 'Camera permission denied. Allow camera access in System Settings → Privacy & Security → Camera, then reload.'
        : `Could not start: ${msg}`,
      true,
    );
    buttons.forEach((b) => (b.disabled = false));
  }
}

function onGesture(i: PlayerId, e: GestureEvent, players: [PlayerCtx, PlayerCtx]) {
  effects.onGesture(i, e, players);
  if (e.type === 'callout') {
    hud.callout(`${e.text}…`, i, players);
    sfx.callout(e.text as 'KA' | 'ME' | 'HA');
  } else if (e.type === 'fire') {
    hud.callout('HAAAA!', i, players, true);
    sfx.fire();
    sfx.callout('FIRE');
  } else if (e.type === 'powerStart') {
    if (!players[i].ctrl.superSaiyan) hud.callout('HAAAAA…', i, players);
    sfx.powerUp();
  } else if (e.type === 'transform') {
    hud.showBanner('SUPER SAIYAN!', `Player ${i + 1} broke the limit`, 1.8, i);
    sfx.transform();
    sfx.callout('SSJ');
  }
}

function onGame(e: GameEvent, now: number) {
  effects.onGame(e);
  demo?.onGameEvent(e, now);
  switch (e.type) {
    case 'round':
      hud.showBanner(`ROUND ${e.round}`, 'Get ready…', CONFIG.round.introDuration - 0.2);
      break;
    case 'fight':
      hud.showBanner('FIGHT!', '', 0.9);
      break;
    case 'clash':
      hud.showBanner('BEAM STRUGGLE!', 'Pump your arms forward!', 1.3);
      sfx.clashStart();
      break;
    case 'ko':
      hud.showBanner(`PLAYER ${e.winner + 1} WINS!`, `${game.scores[0]} — ${game.scores[1]}`, 3.2, e.winner);
      sfx.explosion();
      break;
    default:
      break;
  }
}
let simTime = 0;

function frame(nowMs: number) {
  requestAnimationFrame(frame);
  const realDt = clamp((nowMs - lastFrame) / 1000, 0, 0.05);
  lastFrame = nowMs;
  if (paused) return;
  const dt = realDt;
  simTime += dt;
  const now = simTime;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;

  // 1. Input: detect poses on each new camera frame (or synthesize them in demo mode).
  if (demo) {
    tracker.update(demo.frame(now), now, layout.aspect);
  } else if (detector && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const raw = detector.detect(video, nowMs);
    if (!recorder.push(raw, now)) stopRecording();
    tracker.update(raw, now, layout.aspect);
  } else {
    tracker.tick(now);
  }

  // 2. Per-player form analysis + gesture state machine.
  const players = tracker.slots.map((slot, i) => {
    const analysis = slot.present && slot.frame ? analyzePose(slot.frame, layout.aspect) : null;
    if (!slot.present && wasPresent[i]) ctrls[i].reset();
    wasPresent[i] = slot.present;
    return { present: slot.present, analysis, ctrl: ctrls[i] };
  }) as [PlayerCtx, PlayerCtx];
  players.forEach((p, i) => {
    for (const e of p.ctrl.update(dt, p.analysis)) onGesture(i as PlayerId, e, players);
  });

  // 3. Game rules: beams, hits, beam struggle, rounds.
  for (const e of game.update(dt, players, tracker.maxPlayers)) onGame(e, now);

  // 4. Visuals + sound + HUD.
  effects.update(dt, now, players, game);
  players.forEach((p, i) => {
    const b = game.beams[i];
    sfx.setPlayer(i as PlayerId, {
      charging: p.ctrl.phase === 'charging',
      charge: p.ctrl.charge,
      powering: p.ctrl.phase === 'powering',
      ascend: p.ctrl.ascend,
      firing: b.active,
      power: game.struggle.active ? game.struggle.intensity / 1.6 : 0.6,
    });
  });
  sfx.setClash(game.struggle.active ? game.struggle.intensity : 0);
  hud.update(dt, players, game, tracker.maxPlayers, fps);
  const post = effects.post(now);
  renderer.render(post.params, post.tint);
  overlay.draw(tracker, players);
}

function stopRecording() {
  const n = recorder.stop(layout.aspect);
  hud.setRecording(false);
  hud.showBanner('RECORDING SAVED', `${n} frames → Downloads`, 1.5);
}

window.addEventListener('keydown', (e) => {
  if (startScreen && !startScreen.classList.contains('hidden')) return;
  switch (e.key.toLowerCase()) {
    case 'd':
      hud.showBanner(['OVERLAY OFF', 'SKELETON', 'SKELETON + SCORES'][overlay.cycle()], '', 0.8);
      break;
    case 'm':
      sfx.setMuted(!sfx.muted);
      hud.showBanner(sfx.muted ? 'SOUND OFF' : 'SOUND ON', '', 0.8);
      break;
    case 'v':
      sfx.voice = !sfx.voice;
      hud.showBanner(sfx.voice ? 'VOICE ON' : 'VOICE OFF', '', 0.8);
      break;
    case 'p':
      tracker.maxPlayers = tracker.maxPlayers === 2 ? 1 : 2;
      hud.showBanner(tracker.maxPlayers === 2 ? '2 PLAYERS' : '1 PLAYER', '', 0.8);
      break;
    case 'k':
      if (!detector) {
        hud.showBanner('CAMERA ONLY', 'Recording needs the live camera', 1.2);
      } else if (recorder.active) {
        stopRecording();
      } else {
        recorder.start(simTime);
        hud.setRecording(true);
        hud.showBanner('RECORDING', 'Do the move, then press K again', 1.2);
      }
      break;
    case 'r':
      game.resetScores();
      hud.showBanner('SCORES RESET', '', 0.8);
      break;
    case ' ':
      paused = !paused;
      hud.showBanner(paused ? 'PAUSED' : '', '', paused ? 1e9 : 0.01);
      e.preventDefault();
      break;
    case 'f':
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
      break;
    default:
      break;
  }
});

$<HTMLButtonElement>('start-camera').addEventListener('click', () => void start('camera'));
$<HTMLButtonElement>('start-demo').addEventListener('click', () => void start('demo'));
if (new URLSearchParams(location.search).has('demo')) void start('demo');

if (import.meta.env.DEV) {
  Object.assign(window, { __kameyoko: { game, ctrls, tracker, setPaused: (v: boolean) => (paused = v) } });
}
