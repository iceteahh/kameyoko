import { buildWorldPose, toPoseFrame, type PoseName } from '../src/demo/skeleton';
import { analyzePose } from '../src/gesture/analyze';
import { P } from '../src/tracking/landmarks';
import type { V3 } from '../src/types';

/**
 * MediaPipe underestimates depth for limbs pointed at the lens: wrists come
 * forward much less than they really do, so straight arms read as bent.
 */
export function facingCamera(world: V3[], opts: { wristZ?: number; elbowZ?: number; lowerHands?: number } = {}): V3[] {
  const { wristZ = 0.4, elbowZ = 0.7, lowerHands = 0 } = opts;
  const hand = new Set<number>([P.L_WRIST, P.R_WRIST, P.L_PINKY, P.R_PINKY, P.L_INDEX, P.R_INDEX, P.L_THUMB, P.R_THUMB]);
  return world.map((p, i) => {
    const r = { x: p.z, y: p.y, z: -p.x };
    if (hand.has(i)) return { ...r, y: r.y + lowerHands, z: r.z * wristZ };
    if (i === P.L_ELBOW || i === P.R_ELBOW) return { ...r, y: r.y + lowerHands * 0.5, z: r.z * elbowZ };
    return r;
  });
}

export const analyse = (world: V3[]) => analyzePose({ pose: toPoseFrame(world, { facing: 1, cx: 0.5 }), hands: [] }, 16 / 9)!;
export const realistic = (name: PoseName, opts?: Parameters<typeof facingCamera>[1]) => analyse(facingCamera(buildWorldPose(name), opts));

/** Deterministic RNG so noisy tests are reproducible. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ARM: number[] = [P.L_ELBOW, P.R_ELBOW, P.L_WRIST, P.R_WRIST, P.L_PINKY, P.R_PINKY, P.L_INDEX, P.R_INDEX, P.L_THUMB, P.R_THUMB];

/** Bad elbow estimates: pull the elbows toward the shoulder–wrist line so bent arms read straighter. */
export function inflateElbows(world: V3[], k: number): V3[] {
  const w = world.map((p) => ({ ...p }));
  for (const [s, e, wr] of [[P.L_SHOULDER, P.L_ELBOW, P.L_WRIST], [P.R_SHOULDER, P.R_ELBOW, P.R_WRIST]]) {
    const m = { x: (w[s].x + w[wr].x) / 2, y: (w[s].y + w[wr].y) / 2, z: (w[s].z + w[wr].z) / 2 };
    w[e] = { x: w[e].x + (m.x - w[e].x) * k, y: w[e].y + (m.y - w[e].y) * k, z: w[e].z + (m.z - w[e].z) * k };
  }
  return w;
}

export function noisy(world: V3[], amount: number, rand: () => number): V3[] {
  return world.map((p, i) =>
    ARM.includes(i)
      ? { x: p.x + (rand() - 0.5) * amount, y: p.y + (rand() - 0.5) * amount, z: p.z + (rand() - 0.5) * amount * 3 }
      : p,
  );
}

