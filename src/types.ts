export interface V2 {
  x: number;
  y: number;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export type PlayerId = 0 | 1;
export type RGB = readonly [number, number, number];

/**
 * One person's pose, already mirrored into display space (selfie view):
 * image coords are normalized 0..1 of the video frame, world coords are meters
 * centered on the hips (y down, smaller z = closer to the camera).
 */
export interface PoseFrame {
  image: V3[];
  world: V3[];
  vis: number[];
}

export interface HandFrame {
  image: V3[];
  world: V3[];
  score: number;
  /** Which pose wrist this hand was matched to: 0 = landmark 15, 1 = landmark 16. */
  side?: 0 | 1;
}

export interface PlayerFrame {
  pose: PoseFrame;
  hands: HandFrame[];
}

export interface RawFrame {
  poses: PoseFrame[];
  hands: HandFrame[];
}
