import { CONFIG } from '../config';
import type { FormAnalysis } from '../gesture/analyze';
import type { GestureController } from '../gesture/controller';
import type { Layout } from '../layout';
import { clamp, damp, dist2, lerp2, norm2, rayToRectEdge, sub2 } from '../math';
import type { PlayerId, V2 } from '../types';
import { stepStruggle, strugglePower, type StruggleState } from './struggle';

export interface PlayerCtx {
  present: boolean;
  analysis: FormAnalysis | null;
  ctrl: GestureController;
}

export interface Beam {
  owner: PlayerId;
  active: boolean;
  /** Fades in/out so beams don't pop. */
  alpha: number;
  mode: 'side' | 'camera';
  origin: V2;
  dir: V2;
  length: number;
  width: number;
  age: number;
  edgeHit: boolean;
}

export interface Struggle extends StruggleState {
  active: boolean;
  point: V2;
  powers: [number, number];
  intensity: number;
}

export type GameEvent =
  | { type: 'fire'; player: PlayerId; at: V2; mode: Beam['mode'] }
  | { type: 'clash'; at: V2 }
  | { type: 'ko'; loser: PlayerId; winner: PlayerId; at: V2 }
  | { type: 'edge'; player: PlayerId; at: V2 }
  | { type: 'round'; round: number }
  | { type: 'fight' };

const EDGE_MARGIN = 80;

function newBeam(owner: PlayerId): Beam {
  return {
    owner,
    active: false,
    alpha: 0,
    mode: 'side',
    origin: { x: 0, y: 0 },
    dir: { x: owner === 0 ? 1 : -1, y: 0 },
    length: 0,
    width: 0,
    age: 0,
    edgeHit: false,
  };
}

export class Game {
  versus = false;
  phase: 'play' | 'intro' | 'ko' = 'play';
  phaseTime = 0;
  round = 0;
  scores: [number, number] = [0, 0];
  winner: PlayerId | null = null;
  readonly beams: [Beam, Beam] = [newBeam(0), newBeam(1)];
  readonly struggle: Struggle = {
    active: false,
    t: 0.5,
    vel: 0,
    time: 0,
    point: { x: 0, y: 0 },
    powers: [1, 1],
    intensity: 0,
  };
  private koLoser: PlayerId | null = null;
  private bothTime = 0;

  constructor(private layout: Layout) {}

  resetScores() {
    this.scores = [0, 0];
    this.round = 0;
  }

  update(dt: number, players: [PlayerCtx, PlayerCtx], maxPlayers: 1 | 2): GameEvent[] {
    const ev: GameEvent[] = [];
    const bothHere = maxPlayers === 2 && players.every((p) => p.present && p.analysis);
    this.bothTime = bothHere ? this.bothTime + dt : 0;

    if (bothHere && !this.versus && this.bothTime >= CONFIG.round.joinDelay) {
      this.versus = true;
      this.startRound(players, ev);
    } else if (!bothHere && this.versus) {
      this.versus = false;
      this.phase = 'play';
      this.struggle.active = false;
    }

    this.phaseTime += dt;
    if (this.versus) {
      if (this.phase === 'intro' && this.phaseTime >= CONFIG.round.introDuration) {
        this.phase = 'play';
        this.phaseTime = 0;
        ev.push({ type: 'fight' });
      } else if (this.phase === 'ko' && this.phaseTime >= CONFIG.round.koDuration) {
        this.startRound(players, ev);
      }
    }

    for (const p of players) {
      p.ctrl.fireBlocked = this.versus && this.phase !== 'play';
      p.ctrl.drain = !this.struggle.active;
    }

    players.forEach((p, i) => this.updateBeam(i as PlayerId, dt, players, p, ev));

    if (this.versus && this.phase !== 'ko') this.updateVersus(dt, players, ev);
    else this.updateFree(dt, ev);
    return ev;
  }

  private startRound(players: [PlayerCtx, PlayerCtx], ev: GameEvent[]) {
    this.round++;
    this.phase = 'intro';
    this.phaseTime = 0;
    this.winner = null;
    this.koLoser = null;
    this.struggle.active = false;
    for (const p of players) p.ctrl.reset();
    for (const b of this.beams) {
      b.active = false;
      b.length = 0;
    }
    ev.push({ type: 'round', round: this.round });
  }

  private target(i: PlayerId, players: [PlayerCtx, PlayerCtx]): V2 | null {
    const opp = players[1 - i];
    if (!opp.present || !opp.analysis) return null;
    const oppBeam = this.beams[1 - i];
    return oppBeam.active ? oppBeam.origin : this.layout.toScreen(opp.analysis.chestCenter);
  }

  private updateBeam(i: PlayerId, dt: number, players: [PlayerCtx, PlayerCtx], p: PlayerCtx, ev: GameEvent[]) {
    const b = this.beams[i];
    const a = p.analysis;
    const firing = p.present && a !== null && p.ctrl.phase === 'firing';

    if (firing && a) {
      const origin = this.layout.toScreen(a.handsCenter);
      const target = this.versus ? this.target(i, players) : null;
      // Versus mode auto-aims at the opponent so it works whether players face
      // each other or the camera. Free play follows the arms.
      const wanted = target ? norm2(sub2(target, origin), b.dir) : a.aimDir;
      if (!b.active) {
        b.active = true;
        b.length = 0;
        b.age = 0;
        b.edgeHit = false;
        b.mode = !this.versus && a.towardCamera ? 'camera' : 'side';
        b.dir = wanted;
        ev.push({ type: 'fire', player: i, at: origin, mode: b.mode });
      }
      // Let the beam mode settle while the arms finish the thrust.
      if (!this.versus && b.age < 0.25) b.mode = a.towardCamera ? 'camera' : 'side';
      b.origin = origin;
      b.dir = norm2(lerp2(b.dir, wanted, 1 - Math.exp(-10 * dt)), wanted);
      b.age += dt;
      b.alpha = damp(b.alpha, 1, 14, dt);
      const share = this.struggle.active ? this.struggle.powers[i] / (this.struggle.powers[0] + this.struggle.powers[1]) : 0.5;
      b.width =
        this.layout.height *
        CONFIG.beam.width *
        (0.55 + 0.45 * p.ctrl.fireCharge) *
        (0.8 + 0.4 * p.ctrl.formScore) *
        (0.7 + 0.6 * share) *
        (1 + 0.25 * Math.min(p.ctrl.pump, 1)) *
        (p.ctrl.superSaiyan ? CONFIG.superSaiyan.beamWidth : 1);
    } else {
      b.active = false;
      b.alpha = damp(b.alpha, 0, 7, dt);
      if (b.alpha < 0.01) b.length = 0;
    }
  }

  /** Free play (solo, or the winner's beam during a KO): beams fly to the screen edge. */
  private updateFree(dt: number, ev: GameEvent[]) {
    const { width: W, height: H } = this.layout;
    this.struggle.active = false;
    for (const b of this.beams) {
      if (!b.active || b.mode === 'camera') continue;
      const maxLen = rayToRectEdge(b.origin, b.dir, W, H, EDGE_MARGIN);
      b.length = Math.min(maxLen, b.length + CONFIG.beam.speed * W * dt);
      const hit = b.length >= maxLen - 1;
      if (hit && !b.edgeHit) {
        const d = rayToRectEdge(b.origin, b.dir, W, H, 0);
        ev.push({ type: 'edge', player: b.owner, at: { x: b.origin.x + b.dir.x * d, y: b.origin.y + b.dir.y * d } });
      }
      b.edgeHit = hit;
    }
  }

  private updateVersus(dt: number, players: [PlayerCtx, PlayerCtx], ev: GameEvent[]) {
    const [A, B] = this.beams;
    const D = dist2(A.origin, B.origin);
    const s = this.struggle;
    const speed = CONFIG.beam.speed * this.layout.width;

    if (s.active) {
      if (A.active && B.active) {
        s.powers = [0, 1].map((i) => {
          const c = players[i].ctrl;
          return strugglePower(c.fireCharge, c.formScore, c.pump) * (c.superSaiyan ? CONFIG.superSaiyan.power : 1);
        }) as [number, number];
        const { state, loser } = stepStruggle(s, s.powers[0], s.powers[1], dt);
        Object.assign(s, state);
        A.length = s.t * D;
        B.length = (1 - s.t) * D;
        s.point = lerp2(A.origin, B.origin, s.t);
        s.intensity = clamp((s.powers[0] + s.powers[1]) / 2.4, 0.5, 1.6);
        if (loser !== null) this.ko(loser, players, ev);
        return;
      }
      // Someone let go: the other beam rushes through.
      s.active = false;
    }

    for (const [b, i] of [[A, 0], [B, 1]] as const) {
      if (!b.active) continue;
      const opp = players[1 - i];
      const oppBeam = this.beams[1 - i];
      let limit = D;
      if (!oppBeam.active && opp.analysis) {
        const chest = this.layout.toScreen(opp.analysis.chestCenter);
        limit = Math.max(0, dist2(b.origin, chest) - 0.25 * this.layout.lengthToScreen(opp.analysis.torsoLen));
      }
      b.length = Math.min(limit, b.length + speed * dt);
      b.edgeHit = false;
    }

    if (A.active && B.active && A.length + B.length >= D - 1) {
      s.active = true;
      // Whoever fired first keeps an edge, but the clash starts nearer the middle for drama.
      const met = A.length / Math.max(A.length + B.length, 1);
      s.t = clamp(met + (0.5 - met) * CONFIG.struggle.recenter, 0.15, 0.85);
      s.vel = 0;
      s.time = 0;
      s.point = lerp2(A.origin, B.origin, s.t);
      ev.push({ type: 'clash', at: s.point });
      return;
    }
    for (const [b, i] of [[A, 0], [B, 1]] as const) {
      const opp = players[1 - i];
      if (!b.active || this.beams[1 - i].active || !opp.analysis) continue;
      const chest = this.layout.toScreen(opp.analysis.chestCenter);
      const limit = Math.max(0, dist2(b.origin, chest) - 0.25 * this.layout.lengthToScreen(opp.analysis.torsoLen));
      if (b.length >= limit - 1) {
        this.ko((1 - i) as PlayerId, players, ev);
        return;
      }
    }
  }

  private ko(loser: PlayerId, players: [PlayerCtx, PlayerCtx], ev: GameEvent[]) {
    const winner = (1 - loser) as PlayerId;
    this.phase = 'ko';
    this.phaseTime = 0;
    this.winner = winner;
    this.koLoser = loser;
    this.scores[winner]++;
    this.struggle.active = false;
    players[loser].ctrl.endFire();
    players[loser].ctrl.superSaiyan = false;
    const a = players[loser].analysis;
    const at = a ? this.layout.toScreen(a.chestCenter) : this.beams[loser].origin;
    ev.push({ type: 'ko', loser, winner, at });
  }

  get loser(): PlayerId | null {
    return this.koLoser;
  }
}
