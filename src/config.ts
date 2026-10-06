import type { RGB } from './types';

/** All gesture/game tuning in one place. Distances in gesture checks are ratios of body size. */
export const CONFIG = {
  tracking: {
    /** Seconds a player may vanish before their slot is released. */
    lostGrace: 0.6,
    minShoulderVisibility: 0.4,
    filter: { minCutoff: 1.4, beta: 4, dCutoff: 1 },
  },
  charge: {
    startThreshold: 0.55,
    holdThreshold: 0.4,
    /** Seconds the charge pose must be held before charging begins. */
    holdToStart: 0.2,
    /** Charge gained per second at perfect form (full charge ≈ 2.4s). */
    rate: 0.42,
    decay: 0.6,
    /** Seconds allowed to move from the charge pose into the thrust. */
    grace: 0.8,
    calloutAt: [0.1, 0.36, 0.62, 0.88],
  },
  fire: {
    startThreshold: 0.55,
    holdThreshold: 0.3,
    minCharge: 0.2,
    /** The release must persist this long before the beam fires (filters single-frame noise). */
    confirm: 0.1,
    breakGrace: 0.35,
    /** Charge drained per second while firing outside a struggle. */
    drain: 0.16,
    cooldown: 0.6,
  },
  superSaiyan: {
    /** Power-up stance (horse stance, fists at the hips): same start/hold scheme as the charge pose. */
    startThreshold: 0.55,
    holdThreshold: 0.4,
    holdToStart: 0.3,
    /** Seconds the stance may flicker out before powering up stops. */
    grace: 0.4,
    /** Seconds of powering up to transform at perfect form. */
    holdToTransform: 2.5,
    /** Transformation progress lost per second while not powering up. */
    decay: 0.4,
    /** Once transformed (until the next round, a KO or leaving view): faster charge, wider beam, stronger push. */
    chargeRate: 1.6,
    beamWidth: 1.3,
    power: 1.35,
    glow: [1.0, 0.76, 0.1] as RGB,
    core: [1.0, 0.98, 0.72] as RGB,
  },
  pump: { gain: 4, decay: 1.6, minVelocity: 0.25, max: 1.6 },
  beam: {
    /** Screen widths per second (slow enough that the opponent can counter-fire). */
    speed: 0.6,
    /** Beam width as a fraction of screen height at full power. */
    width: 0.072,
  },
  struggle: {
    speed: 0.55,
    koMargin: 0.03,
    /** How far the first clash point is pulled toward the middle (0 = where beams met). */
    recenter: 0.4,
  },
  round: {
    /** Both players must be in view this long before a duel starts (filters stray detections). */
    joinDelay: 1.0,
    introDuration: 1.6,
    koDuration: 3.8,
  },
  colors: {
    players: [
      { glow: [0.18, 0.55, 1.0], core: [0.8, 0.95, 1.0], css: '#3aa0ff' },
      { glow: [1.0, 0.45, 0.08], core: [1.0, 0.95, 0.75], css: '#ff8a1f' },
    ] as { glow: RGB; core: RGB; css: string }[],
  },
};
