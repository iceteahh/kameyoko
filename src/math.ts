import type { V2, V3 } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Linear 0 at `a`, 1 at `b` (works for a > b as a falling ramp). */
export const ramp = (v: number, a: number, b: number) => clamp((v - a) / (b - a), 0, 1);
/** Frame-rate independent exponential approach. */
export const damp = (cur: number, target: number, rate: number, dt: number) =>
  lerp(cur, target, 1 - Math.exp(-rate * dt));
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export const v2 = (x: number, y: number): V2 => ({ x, y });
export const add2 = (a: V2, b: V2): V2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub2 = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale2 = (a: V2, s: number): V2 => ({ x: a.x * s, y: a.y * s });
export const len2 = (a: V2) => Math.hypot(a.x, a.y);
export const dist2 = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid2 = (a: V2, b: V2): V2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp2 = (a: V2, b: V2, t: number): V2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const perp2 = (a: V2): V2 => ({ x: -a.y, y: a.x });
export function norm2(a: V2, fallback: V2 = { x: 1, y: 0 }): V2 {
  const l = len2(a);
  return l < 1e-6 ? { ...fallback } : { x: a.x / l, y: a.y / l };
}

export const add3 = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale3 = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len3 = (a: V3) => Math.hypot(a.x, a.y, a.z);
export const dist3 = (a: V3, b: V3) => len3(sub3(a, b));
export const mid3 = (a: V3, b: V3): V3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
export const lerp3 = (a: V3, b: V3, t: number): V3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});
export function norm3(a: V3): V3 {
  const l = len3(a);
  return l < 1e-9 ? { x: 0, y: 0, z: 0 } : scale3(a, 1 / l);
}

/** Interior angle at `b` in degrees (180 = straight). */
export function angleAt(a: V3, b: V3, c: V3): number {
  const u = sub3(a, b);
  const w = sub3(c, b);
  const d = len3(u) * len3(w);
  if (d < 1e-9) return 180;
  return (Math.acos(clamp(dot3(u, w) / d, -1, 1)) * 180) / Math.PI;
}

/** Distance from `o` along unit `dir` until leaving the rect [0,w]x[0,h] expanded by `margin`. */
export function rayToRectEdge(o: V2, dir: V2, w: number, h: number, margin = 0): number {
  let t = Infinity;
  if (dir.x > 1e-6) t = Math.min(t, (w + margin - o.x) / dir.x);
  if (dir.x < -1e-6) t = Math.min(t, (-margin - o.x) / dir.x);
  if (dir.y > 1e-6) t = Math.min(t, (h + margin - o.y) / dir.y);
  if (dir.y < -1e-6) t = Math.min(t, (-margin - o.y) / dir.y);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}
