import { describe, expect, it } from 'vitest';
import { Demo } from '../src/demo/demo';
import { buildWorldPose, toPoseFrame } from '../src/demo/skeleton';
import { Game, type GameEvent, type PlayerCtx } from '../src/game/game';
import { analyzePose } from '../src/gesture/analyze';
import { GestureController } from '../src/gesture/controller';
import { Layout } from '../src/layout';
import { Tracker } from '../src/tracking/tracker';

/** Runs the full pipeline (tracker → analysis → gestures → game) on the scripted demo duel. */
function simulateDemo(seconds: number) {
  const layout = new Layout();
  layout.update(1280, 720, 1280, 720);
  const tracker = new Tracker();
  const ctrls = [new GestureController(), new GestureController()];
  const game = new Game(layout);
  const demo = new Demo(0);
  const events: (GameEvent & { time: number })[] = [];
  const dt = 1 / 60;
  for (let now = 0; now < seconds; now += dt) {
    tracker.update(demo.frame(now), now, layout.aspect);
    const players = tracker.slots.map((s, i) => ({
      present: s.present,
      analysis: s.frame ? analyzePose(s.frame, layout.aspect) : null,
      ctrl: ctrls[i],
    })) as [PlayerCtx, PlayerCtx];
    players.forEach((p) => p.ctrl.update(dt, p.analysis));
    for (const e of game.update(dt, players, 2)) {
      events.push({ ...e, time: now });
      demo.onGameEvent(e, now);
    }
  }
  return { events, game };
}

describe('versus game (demo duel end-to-end)', () => {
  it('runs round → fight → fire → clash → KO and alternates winners', () => {
    const { events, game } = simulateDemo(30);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('round');
    expect(types).toContain('fight');
    expect(types).toContain('fire');
    expect(types).toContain('clash');
    const kos = events.filter((e): e is Extract<GameEvent, { type: 'ko' }> & { time: number } => e.type === 'ko');
    expect(kos.length).toBeGreaterThanOrEqual(2);
    expect(kos[0].winner).toBe(0);
    expect(kos[1].winner).toBe(1);
    expect(game.scores).toEqual([kos.filter((k) => k.winner === 0).length, kos.filter((k) => k.winner === 1).length]);
  });
});

describe('solo play', () => {
  it('beam flies to the screen edge', () => {
    const layout = new Layout();
    layout.update(1280, 720, 1280, 720);
    const game = new Game(layout);
    const ctrl = new GestureController();
    ctrl.phase = 'firing';
    ctrl.fireCharge = 1;
    ctrl.charge = 1;
    const a = analyzePose({ pose: toPoseFrame(buildWorldPose('fire'), { facing: 1, cx: 0.3 }), hands: [] }, 16 / 9);
    const players: [PlayerCtx, PlayerCtx] = [
      { present: true, analysis: a, ctrl },
      { present: false, analysis: null, ctrl: new GestureController() },
    ];
    const events: GameEvent[] = [];
    for (let i = 0; i < 120; i++) events.push(...game.update(1 / 60, players, 2));
    expect(game.versus).toBe(false);
    expect(events.some((e) => e.type === 'fire')).toBe(true);
    expect(events.some((e) => e.type === 'edge')).toBe(true);
    expect(game.beams[0].length).toBeGreaterThan(500);
  });
});

describe('super saiyan', () => {
  it('the solo demo powers up to Super Saiyan before its first Kamehameha', () => {
    const layout = new Layout();
    layout.update(1280, 720, 1280, 720);
    const tracker = new Tracker();
    tracker.maxPlayers = 1;
    const ctrl = new GestureController();
    const demo = new Demo(0, 16 / 9, true);
    const types: string[] = [];
    const dt = 1 / 60;
    for (let now = 0; now < 10; now += dt) {
      tracker.update(demo.frame(now), now, layout.aspect);
      const s = tracker.slots[0];
      for (const e of ctrl.update(dt, s.frame ? analyzePose(s.frame, layout.aspect) : null)) types.push(e.type);
    }
    expect(types.indexOf('transform')).toBeGreaterThan(-1);
    expect(types.indexOf('transform')).toBeLessThan(types.indexOf('fire'));
    expect(ctrl.superSaiyan).toBe(true);
  });

  it('pushes harder in a beam struggle', () => {
    const layout = new Layout();
    layout.update(1280, 720, 1280, 720);
    const game = new Game(layout);
    const pose = (facing: 1 | -1, cx: number) =>
      analyzePose({ pose: toPoseFrame(buildWorldPose('fire'), { facing, cx }), hands: [] }, 16 / 9);
    const ctrls = [new GestureController(), new GestureController()];
    const players = ctrls.map((ctrl, i) => ({ present: true, analysis: pose(i === 0 ? 1 : -1, i === 0 ? 0.2 : 0.8), ctrl })) as [
      PlayerCtx,
      PlayerCtx,
    ];
    for (let k = 0; k < 1800; k++) {
      // Hold both players in an identical full-power beam; only player 1 is Super Saiyan.
      for (const c of ctrls) {
        c.phase = 'firing';
        c.charge = c.fireCharge = 1;
        c.formScore = 1;
      }
      ctrls[1].superSaiyan = true;
      const ev = game.update(1 / 60, players, 2);
      if (ev.some((e) => e.type === 'ko')) break;
    }
    expect(game.winner).toBe(1);
  });
});
