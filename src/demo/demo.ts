import type { GameEvent } from '../game/game';
import type { PlayerId, RawFrame } from '../types';
import { blendWorld, buildWorldPose, toPoseFrame, type PoseName } from './skeleton';

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * Scripted two-player duel (no camera needed): both charge, fire, struggle.
 * The winner alternates each round by giving one side faster arm pumps.
 */
export class Demo {
  private roundStart: number;
  private round = 1;
  private koLoser: PlayerId | null = null;

  constructor(
    now: number,
    private aspect = 16 / 9,
    private solo = false,
  ) {
    this.roundStart = now;
  }

  onGameEvent(e: GameEvent, now: number) {
    if (e.type === 'round') {
      this.roundStart = now;
      this.round = e.round;
      this.koLoser = null;
    } else if (e.type === 'ko') {
      this.koLoser = e.loser;
    }
  }

  frame(now: number): RawFrame {
    if (this.solo) return this.soloFrame(now);
    const tau = now - this.roundStart;
    const strong: PlayerId = this.round % 2 === 1 ? 0 : 1;
    const poses = ([0, 1] as const).map((i) => {
      const chargeAt = 0.4 + 0.3 * i;
      const fireAt = 2.9 + 0.35 * i;
      let world;
      if (this.koLoser === i || tau < chargeAt) {
        world = buildWorldPose('idle');
      } else if (tau < fireAt) {
        world = this.blend('idle', 'charge', (tau - chargeAt) / 0.35);
      } else {
        const ft = tau - fireAt;
        // Pump = pull the hands back a little and punch forward again.
        const [freq, amp] = i === strong ? [3, 0.045] : [1.5, 0.025];
        const pump = ft > 0.25 ? amp * (Math.sin(2 * Math.PI * freq * (ft - 0.25)) - 0.4) : 0;
        world = blendWorld(buildWorldPose('charge'), buildWorldPose('fire', pump), smooth(ft / 0.18));
      }
      return toPoseFrame(world, { facing: i === 0 ? 1 : -1, cx: i === 0 ? 0.18 : 0.82, aspect: this.aspect });
    });
    return { poses, hands: [] };
  }

  /** One player facing the camera, firing straight at the viewer, on a 7s loop. */
  private soloFrame(now: number): RawFrame {
    const tau = (now - this.roundStart) % 7;
    let world;
    if (tau < 0.6) world = buildWorldPose('idle');
    else if (tau < 3.0) world = this.blend('idle', 'charge', (tau - 0.6) / 0.35);
    else if (tau < 5.5) world = this.blend('charge', 'fire', (tau - 3.0) / 0.18);
    else world = this.blend('fire', 'idle', (tau - 5.5) / 0.4);
    // Authored facing +x; rotate so the arms point at the lens (-z).
    const facingCamera = world.map((p) => ({ x: p.z, y: p.y, z: -p.x }));
    return { poses: [toPoseFrame(facingCamera, { facing: 1, cx: 0.5, aspect: this.aspect })], hands: [] };
  }

  private blend(a: PoseName, b: PoseName, t: number) {
    return blendWorld(buildWorldPose(a), buildWorldPose(b), smooth(t));
  }
}
