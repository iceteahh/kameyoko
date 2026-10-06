import { angleAt, clamp, dist3, len2, len3, lerp, mid3, norm2, ramp, sub3 } from '../math';
import { FINGERS, P, PALM_POINTS } from '../tracking/landmarks';
import type { HandFrame, PlayerFrame, V2, V3 } from '../types';

export interface FormChecks {
  /** Wide stance with bent knees; null when legs are not visible. */
  stance: boolean | null;
  handsTogether: boolean;
  /** Charge: hands pulled low to the hip with elbows bent. */
  pullBack: boolean;
  /** Fire: arms extended at chest height. */
  thrust: boolean;
  /** Fingers extended; null when the hand model could not see the hands. */
  palmsOpen: boolean | null;
}

export interface FormAnalysis {
  /** 0..1 match against the "ka-me-ha-me" charge pose. */
  chargePose: number;
  /** 0..1 match against the "HA!" thrust pose. */
  firePose: number;
  /** 0..1 match against Goku's Super Saiyan power-up: deep horse stance, fists clenched at the hips. */
  powerUpPose: number;
  stance: number | null;
  palms: number | null;
  sidePull: number;
  /** Distance of hands from shoulders, as a fraction of arm length (world space). */
  reach: number;
  /** Release-detection cues (loose), exposed for the controller, hints and debugging. */
  extension: number;
  /** Hands in front of the shoulders (world z), in arm lengths. */
  forward: number;
  elbowAvg: number;
  fireTogether: number;
  fireHeight: number;
  /** Hand height below the shoulders in torso lengths (+ = lower). */
  handHeight: number;
  /** handsCenter with x scaled by aspect, so distances are in height units. */
  handsAC: V2;
  /** Display-normalized anchor points. */
  handsCenter: V2;
  chestCenter: V2;
  headTop: V2;
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Torso length in normalized height units. */
  torsoLen: number;
  /** Unit direction of the arms on screen (pixel proportional). */
  aimDir: V2;
  aimStrength: number;
  towardCamera: boolean;
  checks: FormChecks;
  /** Quality of the charge form / thrust form, 0..1. */
  chargeQuality: number;
  fireQuality: number;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);

function avgPoint(points: V3[]): V2 {
  return { x: avg(points.map((p) => p.x)), y: avg(points.map((p) => p.y)) };
}

/** 0 = fist, 1 = fingers fully extended (scale invariant, uses hand world landmarks). */
export function handOpenness(hand: HandFrame): number {
  const w = hand.world;
  const wrist = w[0];
  return avg(
    FINGERS.map(([mcp, tip]) => {
      const ratio = dist3(wrist, w[tip]) / Math.max(dist3(wrist, w[mcp]), 1e-4);
      return ramp(ratio, 1.3, 1.75);
    }),
  );
}

export function analyzePose(frame: PlayerFrame, aspect: number): FormAnalysis | null {
  const { image: im, world: w, vis } = frame.pose;
  if (w.length < 33 || im.length < 33) return null;
  if (Math.min(vis[P.L_SHOULDER], vis[P.R_SHOULDER]) < 0.4) return null;

  const ls = w[P.L_SHOULDER];
  const rs = w[P.R_SHOULDER];
  const le = w[P.L_ELBOW];
  const re = w[P.R_ELBOW];
  const lw = w[P.L_WRIST];
  const rw = w[P.R_WRIST];
  const lh = w[P.L_HIP];
  const rh = w[P.R_HIP];

  // Body-relative scales so thresholds work at any distance from the camera.
  const S = Math.max(dist3(ls, rs), 0.15);
  const shoulderMid = mid3(ls, rs);
  const hipMid = mid3(lh, rh);
  const T = Math.max(dist3(shoulderMid, hipMid), 0.25);
  const armLen = Math.max((dist3(ls, le) + dist3(le, lw) + dist3(rs, re) + dist3(re, rw)) / 2, 0.3);

  const wristMid = mid3(lw, rw);
  const wristGap = dist3(lw, rw) / S;
  const elbowL = angleAt(ls, le, lw);
  const elbowR = angleAt(rs, re, rw);
  const elbowAvg = (elbowL + elbowR) / 2;
  const elbowMin = Math.min(elbowL, elbowR);
  /** Hand height relative to the shoulders in torso lengths (+ = below). */
  const below = (wristMid.y - shoulderMid.y) / T;
  const reachVec = sub3(wristMid, shoulderMid);
  const reach = len3(reachVec) / armLen;

  // --- Charge: cupped hands together, pulled back to the hip, elbows bent.
  const cTogether = ramp(wristGap, 1.0, 0.6);
  const cBent = ramp(elbowAvg, 145, 110);
  const cLow = ramp(below, 0.25, 0.5);
  const chargePose = Math.min(cTogether, cBent, cLow);
  const sidePull = ramp(Math.hypot(wristMid.x - hipMid.x, wristMid.z - hipMid.z) / S, 0.15, 0.5);

  // --- Fire (strict, static): both arms thrust out straight, wrists together, chest height.
  const fExtend = ramp(elbowAvg, 128, 150) * ramp(elbowMin, 110, 135);
  const fTogether = ramp(wristGap, 1.4, 0.8);
  const fReach = ramp(reach, 0.55, 0.78);
  const fHeight = ramp(below, -0.8, -0.45) * ramp(below, 0.95, 0.65);
  const firePose = Math.min(fExtend, fTogether, fReach, fHeight);

  // Loose cues for detecting the release as a *movement* (see GestureController).
  // MediaPipe underestimates depth for arms pointed at the lens, so straight arms
  // often read as ~130°; these alone are too ambiguous to fire on.
  const forward = (shoulderMid.z - wristMid.z) / armLen;
  const extension = Math.max(ramp(elbowAvg, 115, 145) * ramp(elbowMin, 95, 125), ramp(forward, 0.2, 0.45));
  const looseHeight = ramp(below, -0.8, -0.45) * ramp(below, 0.85, 0.6);

  // --- Power-up (Goku going Super Saiyan): fists pulled in to the hips, both elbows bent back,
  // in a deep horse stance (checked below). Wrists apart separates it from the charge pose,
  // bent elbows from arms hanging, and the stance from just standing with hands on hips.
  const pApart = ramp(wristGap, 0.9, 1.2);
  const pBent = ramp(Math.max(elbowL, elbowR), 145, 120);
  const pHeight = ramp(below, 0.3, 0.55) * ramp(below, 1.35, 1.1);

  // --- Stance: feet wide apart, knees bent (only if legs are in frame).
  let stance: number | null = null;
  const legVis = Math.min(vis[P.L_KNEE], vis[P.R_KNEE], vis[P.L_ANKLE], vis[P.R_ANKLE]);
  const legsInFrame = Math.max(im[P.L_ANKLE].y, im[P.R_ANKLE].y) < 0.99;
  if (legVis > 0.5 && legsInFrame) {
    const la = w[P.L_ANKLE];
    const ra = w[P.R_ANKLE];
    const spread = Math.hypot(la.x - ra.x, la.z - ra.z) / S;
    const knee = (angleAt(lh, w[P.L_KNEE], la) + angleAt(rh, w[P.R_KNEE], ra)) / 2;
    stance = 0.55 * ramp(spread, 1.1, 1.7) + 0.45 * ramp(knee, 172, 150);
  }

  // --- Palms from the hand model, when available.
  const palms = frame.hands.length ? avg(frame.hands.map(handOpenness)) : null;
  // The horse stance is required whenever the legs are in frame. Clenched fists help when the
  // hand model can see them; open hands only soften the score.
  const pStance = stance === null ? 1 : ramp(stance, 0.35, 0.6);
  const fists = palms === null ? 1 : 0.6 + 0.4 * ramp(palms, 0.7, 0.35);
  const powerUpPose = Math.min(pApart, pBent, pHeight, pStance) * fists;

  // --- Screen-space anchors.
  const handFor = (side: 0 | 1) => frame.hands.find((h) => h.side === side);
  const palmCenter = (side: 0 | 1, wrist: number, pinky: number, index: number): V2 => {
    const hand = handFor(side);
    if (hand) return avgPoint(PALM_POINTS.map((i) => hand.image[i]));
    return avgPoint([im[wrist], im[pinky], im[index]]);
  };
  const palmL = palmCenter(0, P.L_WRIST, P.L_PINKY, P.L_INDEX);
  const palmR = palmCenter(1, P.R_WRIST, P.R_PINKY, P.R_INDEX);
  const handsCenter = { x: (palmL.x + palmR.x) / 2, y: (palmL.y + palmR.y) / 2 };

  const shoulderImg = { x: (im[P.L_SHOULDER].x + im[P.R_SHOULDER].x) / 2, y: (im[P.L_SHOULDER].y + im[P.R_SHOULDER].y) / 2 };
  const hipImg = { x: (im[P.L_HIP].x + im[P.R_HIP].x) / 2, y: (im[P.L_HIP].y + im[P.R_HIP].y) / 2 };
  const torsoLen = Math.max(Math.hypot((shoulderImg.x - hipImg.x) * aspect, shoulderImg.y - hipImg.y), 0.05);
  const chestCenter = { x: lerp(shoulderImg.x, hipImg.x, 0.3), y: lerp(shoulderImg.y, hipImg.y, 0.3) };
  const headTop = { x: im[P.NOSE].x, y: im[P.NOSE].y - 0.45 * torsoLen };

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  im.forEach((p, i) => {
    if (vis[i] < 0.4) return;
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  });
  const box = { x0, y0: Math.min(y0, headTop.y), x1, y1 };

  // --- Aim: arm direction on screen. Arms pointed at the lens look short on screen
  // relative to the torso, and the world z says they point toward the camera.
  const dirPx = { x: (handsCenter.x - shoulderImg.x) * aspect, y: handsCenter.y - shoulderImg.y };
  const expectedArmImg = torsoLen * (armLen / T);
  const aimStrength = clamp(len2(dirPx) / Math.max(expectedArmImg, 1e-3), 0, 1.5);
  const zFrac = -reachVec.z / Math.max(len3(reachVec), 1e-4);
  const towardCamera = (zFrac > 0.55 && aimStrength < 0.65) || aimStrength < 0.35;

  const stanceOr = (fallback: number) => stance ?? fallback;
  const chargeQuality = clamp(0.5 * chargePose + 0.25 * stanceOr(0.5) + 0.25 * sidePull, 0, 1);
  const fireQuality = clamp(0.5 * firePose + 0.25 * stanceOr(0.5) + 0.25 * (palms ?? 0.6), 0, 1);

  return {
    chargePose,
    firePose,
    powerUpPose,
    stance,
    palms,
    sidePull,
    reach,
    extension,
    forward,
    elbowAvg,
    fireTogether: fTogether,
    fireHeight: looseHeight,
    handHeight: below,
    handsAC: { x: handsCenter.x * aspect, y: handsCenter.y },
    handsCenter,
    chestCenter,
    headTop,
    box,
    torsoLen,
    aimDir: norm2(dirPx),
    aimStrength,
    towardCamera,
    chargeQuality,
    fireQuality,
    checks: {
      stance: stance === null ? null : stance >= 0.5,
      handsTogether: wristGap < 1.0,
      pullBack: Math.min(cLow, cBent) >= 0.5,
      thrust: Math.max(fExtend, extension) >= 0.5 && looseHeight >= 0.5,
      palmsOpen: palms === null ? null : palms >= 0.5,
    },
  };
}
