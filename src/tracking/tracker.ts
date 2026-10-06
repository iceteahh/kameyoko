import { CONFIG } from '../config';
import { clamp } from '../math';
import type { HandFrame, PlayerFrame, PoseFrame, RawFrame } from '../types';
import { P } from './landmarks';
import { PointsFilter } from './oneEuro';

/** New players are assigned by screen side: left half = P1, right half = P2. */
const DEFAULT_HIP_X = [0.3, 0.7];

const hipX = (p: PoseFrame) => (p.image[P.L_HIP].x + p.image[P.R_HIP].x) / 2;

function poseSize(p: PoseFrame): number {
  let y0 = Infinity;
  let y1 = -Infinity;
  p.image.forEach((pt, i) => {
    if (p.vis[i] < 0.3) return;
    y0 = Math.min(y0, pt.y);
    y1 = Math.max(y1, pt.y);
  });
  return Number.isFinite(y0) ? y1 - y0 : 0;
}

const usable = (p: PoseFrame) =>
  Math.min(p.vis[P.L_SHOULDER], p.vis[P.R_SHOULDER]) >= CONFIG.tracking.minShoulderVisibility;

export class PlayerSlot {
  present = false;
  lastSeen = -Infinity;
  frame: PlayerFrame | null = null;
  hipX: number;
  updated = false;
  private imageFilter = new PointsFilter(CONFIG.tracking.filter);
  private worldFilter = new PointsFilter(CONFIG.tracking.filter);

  constructor(readonly index: 0 | 1) {
    this.hipX = DEFAULT_HIP_X[index];
  }

  ingest(pose: PoseFrame, now: number, dt: number) {
    const image = this.imageFilter.filter(pose.image, dt);
    const world = this.worldFilter.filter(pose.world, dt);
    this.frame = { pose: { image, world, vis: pose.vis }, hands: [] };
    this.present = true;
    this.updated = true;
    this.lastSeen = now;
    this.hipX = hipX(this.frame.pose);
  }

  expire(now: number, force = false) {
    if (!this.present) return;
    if (force || now - this.lastSeen > CONFIG.tracking.lostGrace) {
      this.present = false;
      this.frame = null;
      this.hipX = DEFAULT_HIP_X[this.index];
      this.imageFilter.reset();
      this.worldFilter.reset();
    }
  }
}

/** Keeps up to two people in stable player slots and attaches detected hands to them. */
export class Tracker {
  readonly slots: readonly [PlayerSlot, PlayerSlot] = [new PlayerSlot(0), new PlayerSlot(1)];
  maxPlayers: 1 | 2 = 2;
  private lastTime: number | null = null;

  update(raw: RawFrame, now: number, aspect: number) {
    const dt = clamp(this.lastTime === null ? 1 / 30 : now - this.lastTime, 1 / 240, 0.25);
    this.lastTime = now;
    for (const s of this.slots) s.updated = false;

    const sorted = raw.poses.filter(usable).sort((a, b) => poseSize(b) - poseSize(a));
    // People far in the background (or posters/TVs) are much smaller than players: ignore them.
    const largest = sorted.length ? poseSize(sorted[0]) : 0;
    const poses = sorted.filter((p) => poseSize(p) >= largest * 0.5).slice(0, this.maxPlayers);
    const [s0, s1] = this.slots;

    if (poses.length === 2) {
      const [a, b] = poses;
      const keep = Math.abs(hipX(a) - s0.hipX) + Math.abs(hipX(b) - s1.hipX);
      const swap = Math.abs(hipX(a) - s1.hipX) + Math.abs(hipX(b) - s0.hipX);
      const [first, second] = keep <= swap ? [a, b] : [b, a];
      s0.ingest(first, now, dt);
      s1.ingest(second, now, dt);
    } else if (poses.length === 1) {
      const pose = poses[0];
      let target = s0;
      if (this.maxPlayers === 2) {
        const x = hipX(pose);
        const cost = (s: PlayerSlot) => Math.abs(x - s.hipX) + (s.present ? 0 : 0.2);
        target = cost(s1) < cost(s0) ? s1 : s0;
      }
      target.ingest(pose, now, dt);
    }

    this.assignHands(raw.hands, aspect);
    this.tick(now);
  }

  /** Expire players that have not been seen recently (call even when no new frame arrived). */
  tick(now: number) {
    for (const s of this.slots) if (!s.updated) s.expire(now);
    if (this.maxPlayers === 1) this.slots[1].expire(now, true);
  }

  private assignHands(hands: HandFrame[], aspect: number) {
    const targets: { slot: PlayerSlot; side: 0 | 1; x: number; y: number; scale: number }[] = [];
    for (const slot of this.slots) {
      if (!slot.updated || !slot.frame) continue;
      const im = slot.frame.pose.image;
      const ls = im[P.L_SHOULDER];
      const lh = im[P.L_HIP];
      const torso = Math.hypot((ls.x - lh.x) * aspect, ls.y - lh.y);
      const scale = Math.max(torso, 0.05);
      targets.push({ slot, side: 0, x: im[P.L_WRIST].x, y: im[P.L_WRIST].y, scale });
      targets.push({ slot, side: 1, x: im[P.R_WRIST].x, y: im[P.R_WRIST].y, scale });
    }
    const pairs: { h: number; t: number; d: number }[] = [];
    hands.forEach((hand, h) => {
      const w = hand.image[0];
      targets.forEach((t, ti) => {
        const d = Math.hypot((w.x - t.x) * aspect, w.y - t.y) / t.scale;
        if (d < 0.45) pairs.push({ h, t: ti, d });
      });
    });
    pairs.sort((a, b) => a.d - b.d);
    const usedHands = new Set<number>();
    const usedTargets = new Set<number>();
    for (const p of pairs) {
      if (usedHands.has(p.h) || usedTargets.has(p.t)) continue;
      usedHands.add(p.h);
      usedTargets.add(p.t);
      const t = targets[p.t];
      t.slot.frame!.hands.push({ ...hands[p.h], side: t.side });
    }
  }
}
