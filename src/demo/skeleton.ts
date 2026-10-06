import { add3, clamp, dot3, len3, lerp3, norm3, scale3, sub3 } from '../math';
import { P, POSE_COUNT } from '../tracking/landmarks';
import type { PoseFrame, V3 } from '../types';

/**
 * Synthetic skeletons for demo mode and tests. World space matches MediaPipe:
 * meters, hips at the origin, y down, smaller z = closer to the camera.
 * Poses are authored facing +x (profile) and mirrored for facing -1.
 */
export type PoseName = 'idle' | 'charge' | 'chargeFront' | 'fire' | 'powerup';

const UPPER = 0.3;
const FORE = 0.28;
const v = (x: number, y: number, z: number): V3 => ({ x, y, z });

/** Two-bone IK: places the elbow so the wrist reaches `target` (or as close as possible). */
function solveArm(shoulder: V3, target: V3, pole: V3): { elbow: V3; wrist: V3 } {
  const toT = sub3(target, shoulder);
  const dir = norm3(toT);
  const d = clamp(len3(toT), 0.05, (UPPER + FORE) * 0.999);
  const wrist = add3(shoulder, scale3(dir, d));
  const a = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
  const poleDir = norm3(sub3(pole, scale3(dir, dot3(pole, dir))));
  const elbow = add3(add3(shoulder, scale3(dir, a)), scale3(poleDir, h));
  return { elbow, wrist };
}

const STANCE_LEGS = {
  lKnee: v(0.28, 0.38, -0.12),
  lAnkle: v(0.42, 0.8, -0.14),
  rKnee: v(-0.3, 0.4, 0.12),
  rAnkle: v(-0.45, 0.8, 0.14),
};
const IDLE_LEGS = {
  lKnee: v(0.02, 0.42, -0.1),
  lAnkle: v(0.0, 0.84, -0.1),
  rKnee: v(0.02, 0.42, 0.1),
  rAnkle: v(0.0, 0.84, 0.1),
};

export function buildWorldPose(name: PoseName, pump = 0): V3[] {
  const j: V3[] = Array.from({ length: POSE_COUNT }, () => v(0, 0, 0));
  const ls = v(0, -0.5, -0.18);
  const rs = v(0, -0.5, 0.18);
  j[P.L_SHOULDER] = ls;
  j[P.R_SHOULDER] = rs;
  j[P.L_HIP] = v(0, 0, -0.1);
  j[P.R_HIP] = v(0, 0, 0.1);

  // Head.
  j[P.NOSE] = v(0.1, -0.68, 0);
  for (const [i, z] of [[1, -0.02], [2, -0.03], [3, -0.045], [4, 0.02], [5, 0.03], [6, 0.045]] as const) j[i] = v(0.08, -0.71, z);
  j[P.L_EAR] = v(0, -0.69, -0.07);
  j[P.R_EAR] = v(0, -0.69, 0.07);
  j[9] = v(0.09, -0.64, -0.025);
  j[10] = v(0.09, -0.64, 0.025);

  // Legs.
  const legs = name === 'idle' ? IDLE_LEGS : STANCE_LEGS;
  j[P.L_KNEE] = legs.lKnee;
  j[P.L_ANKLE] = legs.lAnkle;
  j[P.R_KNEE] = legs.rKnee;
  j[P.R_ANKLE] = legs.rAnkle;
  j[P.L_HEEL] = add3(legs.lAnkle, v(-0.05, 0.03, 0));
  j[P.R_HEEL] = add3(legs.rAnkle, v(-0.05, 0.03, 0));
  j[P.L_FOOT] = add3(legs.lAnkle, v(0.12, 0.04, 0));
  j[P.R_FOOT] = add3(legs.rAnkle, v(0.12, 0.04, 0));

  // Arms.
  let lt: V3, rt: V3, lp: V3, rp: V3;
  if (name === 'idle') {
    lt = v(0.04, -0.02, -0.22);
    rt = v(0.04, -0.02, 0.22);
    lp = v(-1, 0, -0.3);
    rp = v(-1, 0, 0.3);
  } else if (name === 'charge' || name === 'chargeFront') {
    // Classic: hands pulled back to the hip. Front: cupped in front of the belly.
    const h = name === 'charge' ? v(-0.22, -0.1, 0) : v(0.12, -0.2, 0);
    lt = add3(h, v(0, 0, -0.05));
    rt = add3(h, v(0, 0, 0.05));
    lp = v(-0.6, 0.3, -1);
    rp = v(-0.6, 0.3, 1);
  } else if (name === 'powerup') {
    // Goku's Super Saiyan power-up: fists clenched at the hips, elbows bent back (horse-stance legs).
    lt = v(-0.03, -0.1, -0.25);
    rt = v(-0.03, -0.1, 0.25);
    lp = v(-1, 0, -0.4);
    rp = v(-1, 0, 0.4);
  } else {
    const h = v(0.55 + pump, -0.47, 0);
    lt = add3(h, v(0, 0, -0.04));
    rt = add3(h, v(0, 0, 0.04));
    lp = v(0, 1, -0.3);
    rp = v(0, 1, 0.3);
  }
  const la = solveArm(ls, lt, lp);
  const ra = solveArm(rs, rt, rp);
  j[P.L_ELBOW] = la.elbow;
  j[P.L_WRIST] = la.wrist;
  j[P.R_ELBOW] = ra.elbow;
  j[P.R_WRIST] = ra.wrist;
  for (const [elbow, wrist, pinky, index, thumb] of [
    [la.elbow, la.wrist, P.L_PINKY, P.L_INDEX, P.L_THUMB],
    [ra.elbow, ra.wrist, P.R_PINKY, P.R_INDEX, P.R_THUMB],
  ] as const) {
    const fd = norm3(sub3(wrist, elbow));
    j[pinky] = add3(wrist, add3(scale3(fd, 0.07), v(0, 0.015, 0)));
    j[index] = add3(wrist, add3(scale3(fd, 0.08), v(0, -0.015, 0)));
    j[thumb] = add3(wrist, add3(scale3(fd, 0.04), v(0, -0.03, 0)));
  }
  return j;
}

export function blendWorld(a: V3[], b: V3[], t: number): V3[] {
  return a.map((p, i) => lerp3(p, b[i], t));
}

/** Project a world pose to a mirrored display frame. */
export function toPoseFrame(
  world: V3[],
  opts: { facing: 1 | -1; cx: number; hipY?: number; scale?: number; aspect?: number },
): PoseFrame {
  const { facing, cx, hipY = 0.56, scale = 0.42, aspect = 16 / 9 } = opts;
  const w = world.map((p) => v(p.x * facing, p.y, p.z));
  return {
    world: w,
    image: w.map((p) => v(cx + (p.x * scale) / aspect, hipY + p.y * scale, p.z * scale)),
    vis: w.map(() => 0.99),
  };
}
