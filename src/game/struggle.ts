import { CONFIG } from '../config';
import { clamp, damp } from '../math';

export interface StruggleState {
  /** Clash position as a fraction of the distance from player 0's hands to player 1's. */
  t: number;
  vel: number;
  time: number;
}

/** Push strength: a fuller charge, cleaner form and pumping arms all add power. */
export function strugglePower(fireCharge: number, form: number, pump: number): number {
  return (0.6 + 0.4 * fireCharge) * (0.7 + 0.3 * form) * (1 + 1.3 * pump);
}

export function stepStruggle(
  s: StruggleState,
  powerA: number,
  powerB: number,
  dt: number,
): { state: StruggleState; loser: 0 | 1 | null } {
  const bias = (powerA - powerB) / Math.max(powerA + powerB, 1e-3);
  // A little wobble keeps an even fight looking alive.
  const wobble = Math.sin(s.time * 2.3) * 0.05 + Math.sin(s.time * 5.7 + 1.3) * 0.025;
  const vel = damp(s.vel, (bias + wobble) * CONFIG.struggle.speed, 3, dt);
  const t = clamp(s.t + vel * dt, 0, 1);
  const m = CONFIG.struggle.koMargin;
  const loser = t >= 1 - m ? 1 : t <= m ? 0 : null;
  return { state: { t, vel, time: s.time + dt }, loser };
}
