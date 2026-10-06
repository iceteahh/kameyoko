import { CONFIG } from '../config';
import type { Game, PlayerCtx } from '../game/game';
import type { FormChecks } from '../gesture/analyze';
import type { Layout } from '../layout';
import type { PlayerId } from '../types';

const CHECKS: [keyof FormChecks, string][] = [
  ['stance', 'Wide stance'],
  ['handsTogether', 'Hands together'],
  ['pullBack', 'Pull back to hip'],
  ['thrust', 'Thrust forward'],
  ['palmsOpen', 'Open palms'],
];

const PHASE_LABEL = { idle: 'READY', charging: 'CHARGING', firing: 'FIRING', cooldown: 'RECOVER' } as const;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

class PlayerPanel {
  readonly root: HTMLElement;
  private state: HTMLElement;
  private wins: HTMLElement;
  private chargeFill: HTMLElement;
  private pumpRow: HTMLElement;
  private pumpFill: HTMLElement;
  private form: HTMLElement;
  private checks = new Map<keyof FormChecks, HTMLElement>();

  constructor(i: PlayerId) {
    this.root = el('div', `panel p${i + 1}`);
    this.root.style.setProperty('--pc', CONFIG.colors.players[i].css);
    const head = el('div', 'panel-head');
    head.append(el('span', 'pname', `PLAYER ${i + 1}`), (this.wins = el('span', 'wins')));
    this.state = el('div', 'state', 'WAITING');
    const bar = el('div', 'bar');
    bar.append((this.chargeFill = el('div', 'fill')));
    this.pumpRow = el('div', 'pump-row');
    const pumpBar = el('div', 'bar pump');
    pumpBar.append((this.pumpFill = el('div', 'fill')));
    this.pumpRow.append(el('span', 'pump-label', 'PUSH'), pumpBar);
    const list = el('ul', 'checks');
    for (const [k, label] of CHECKS) {
      const li = el('li', 'unknown', label);
      this.checks.set(k, li);
      list.append(li);
    }
    this.form = el('div', 'form');
    this.root.append(head, this.state, bar, this.pumpRow, list, this.form);
  }

  update(p: PlayerCtx, wins: number, versus: boolean, struggling: boolean) {
    this.root.classList.toggle('absent', !p.present);
    this.wins.textContent = versus ? '★'.repeat(wins) || '—' : '';
    const a = p.analysis;
    if (!p.present || !a) {
      this.state.textContent = 'STEP INTO VIEW';
      this.chargeFill.style.width = '0%';
      this.pumpRow.classList.remove('show');
      for (const li of this.checks.values()) li.className = 'unknown';
      this.form.textContent = '';
      return;
    }
    const ctrl = p.ctrl;
    this.state.textContent = struggling && ctrl.phase === 'firing' ? 'BEAM STRUGGLE!' : PHASE_LABEL[ctrl.phase];
    this.state.dataset.phase = ctrl.phase;
    this.chargeFill.style.width = `${Math.round(ctrl.charge * 100)}%`;
    this.pumpRow.classList.toggle('show', struggling);
    this.pumpFill.style.width = `${Math.round(Math.min(1, ctrl.pump / CONFIG.pump.max) * 100)}%`;
    for (const [k] of CHECKS) {
      const v = a.checks[k];
      this.checks.get(k)!.className = v === null ? 'unknown' : v ? 'ok' : 'no';
    }
    this.form.textContent = `FORM ${Math.round(ctrl.formScore * 100)}%`;
  }
}

export class Hud {
  private panels: [PlayerPanel, PlayerPanel];
  private callouts: HTMLElement;
  private banner: HTMLElement;
  private struggle: HTMLElement;
  private struggleFill: HTMLElement;
  private struggleMarker: HTMLElement;
  private hint: HTMLElement;
  private fps: HTMLElement;
  private rec: HTMLElement;
  private bannerTimer = 0;

  constructor(root: HTMLElement, private layout: Layout) {
    this.panels = [new PlayerPanel(0), new PlayerPanel(1)];
    this.callouts = el('div', 'callouts');
    this.banner = el('div', 'banner');
    this.struggle = el('div', 'struggle');
    const track = el('div', 'struggle-track');
    track.append((this.struggleFill = el('div', 'struggle-fill')), (this.struggleMarker = el('div', 'struggle-marker')));
    this.struggle.append(el('div', 'struggle-title', 'BEAM STRUGGLE — PUMP YOUR ARMS!'), track);
    this.hint = el('div', 'hint');
    this.fps = el('div', 'fps');
    this.rec = el('div', 'rec', '● REC');
    const keys = el('div', 'keys', 'D skeleton · M sound · V voice · P players · Space pause · K record · F fullscreen · R reset');
    root.append(this.panels[0].root, this.panels[1].root, this.callouts, this.banner, this.struggle, this.hint, keys, this.fps, this.rec);
  }

  callout(text: string, player: PlayerId, players: [PlayerCtx, PlayerCtx], big = false) {
    const a = players[player].analysis;
    if (!a) return;
    const at = this.layout.toScreen(a.headTop);
    const div = el('div', `callout${big ? ' big' : ''}`, text);
    div.style.left = `${at.x}px`;
    div.style.top = `${at.y}px`;
    div.style.setProperty('--pc', CONFIG.colors.players[player].css);
    this.callouts.append(div);
    setTimeout(() => div.remove(), big ? 1400 : 900);
  }

  setRecording(on: boolean) {
    this.rec.classList.toggle('show', on);
  }

  showBanner(text: string, sub = '', seconds = 1.5, player?: PlayerId) {
    if (!text) {
      this.banner.classList.remove('show');
      this.bannerTimer = 0;
      return;
    }
    this.banner.innerHTML = '';
    this.banner.append(el('div', 'banner-main', text));
    if (sub) this.banner.append(el('div', 'banner-sub', sub));
    this.banner.style.setProperty('--pc', player === undefined ? '#ffd23f' : CONFIG.colors.players[player].css);
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  update(dt: number, players: [PlayerCtx, PlayerCtx], game: Game, maxPlayers: 1 | 2, fps: number) {
    const struggling = game.struggle.active;
    this.panels.forEach((panel, i) => panel.update(players[i], game.scores[i], game.versus, struggling));
    this.panels[1].root.classList.toggle('hidden', maxPlayers === 1);

    this.struggle.classList.toggle('show', struggling);
    if (struggling) {
      const pct = game.struggle.t * 100;
      this.struggleFill.style.width = `${pct}%`;
      this.struggleMarker.style.left = `${pct}%`;
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }

    this.hint.textContent = this.hintText(players, game, maxPlayers);
    this.fps.textContent = `${Math.round(fps)} fps`;
  }

  private hintText(players: [PlayerCtx, PlayerCtx], game: Game, maxPlayers: 1 | 2): string {
    const here = players.filter((p) => p.present && p.analysis);
    if (here.length === 0) return 'Step back into view — about 2 m from the camera so your whole body fits.';
    if (game.struggle.active) return 'Hold the pose and PUMP your arms forward to push the clash back!';
    const p = here[0];
    if (p.ctrl.phase === 'firing') return 'HAAAA! Hold the thrust to keep the beam going.';
    if (p.ctrl.phase === 'charging' && p.analysis) {
      const a = p.analysis;
      if (p.ctrl.charge < CONFIG.fire.minCharge) return 'Keep charging…';
      if (a.chargePose >= CONFIG.charge.holdThreshold) return 'Now THRUST both palms forward — HA!';
      // Released but not firing yet: say what's missing.
      if (a.fireTogether < 0.5) return 'Keep your wrists together as you push!';
      if (a.handHeight > 0.6) return 'Push a bit higher — at chest height!';
      if (a.handHeight < -0.45) return 'Push a bit lower — at chest height!';
      return 'Push both arms straight out — HA!';
    }
    if (here.length === 1 && maxPlayers === 2 && !game.versus) {
      return 'Cup your hands together at your hip to charge. A second player can step in for a duel!';
    }
    if (p.analysis?.stance === null) return 'Cup both hands at your hip to charge · show your legs for a stance power bonus.';
    return 'Cup both hands at your hip to charge, then thrust forward to fire.';
  }
}
