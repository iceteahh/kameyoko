import { CONFIG } from '../config';
import { damp, dist2, lerp2, ramp } from '../math';
import type { V2 } from '../types';
import type { FormAnalysis } from './analyze';

export type Phase = 'idle' | 'charging' | 'firing' | 'cooldown' | 'powering';

export type GestureEvent =
  | { type: 'chargeStart' }
  | { type: 'callout'; text: string; index: number }
  | { type: 'fire'; charge: number }
  | { type: 'fireEnd' }
  | { type: 'fizzle' }
  | { type: 'powerStart' }
  | { type: 'transform' };

export const CALLOUTS = ['KA', 'ME', 'HA', 'ME'];

/**
 * Per-player state machine: idle → charging (KA-ME-HA-ME) → firing (HA!) → cooldown.
 * From idle, the power-up stance enters `powering`, which transforms into Super Saiyan.
 */
export class GestureController {
  phase: Phase = 'idle';
  /** Stored energy 0..1. Drains while firing (unless `drain` is off). */
  charge = 0;
  /** Charge level at the moment the beam was fired. */
  fireCharge = 0;
  /** Smoothed form quality for the current phase. */
  formScore = 0;
  /** Arm-thrust "button mashing" meter used in beam struggles. */
  pump = 0;
  /** Prevents starting a new beam (round intro / KO). */
  fireBlocked = false;
  drain = true;
  /** Transformed by powering up. Survives beams; cleared by reset() (new round, leaving view, KO). */
  superSaiyan = false;
  /** Progress 0..1 toward transforming; builds while powering up, fades otherwise. */
  ascend = 0;
  /** Debug readouts: how far the hands left the charge spot, and the release score. */
  moved = 0;
  release = 0;

  /** Snapshot of the charge pose: where the hands were cupped and how the arms looked. */
  private anchor: { hands: V2; forward: number; elbow: number } | null = null;
  private releaseTime = 0;

  private hold = 0;
  private powerHold = 0;
  private grace = 0;
  private lost = 0;
  private cool = 0;
  private callout = 0;
  private lastReach: number | null = null;
  private reachDt = 0;
  private reachVel = 0;

  reset() {
    this.resetCycle();
    this.superSaiyan = false;
    this.ascend = 0;
  }

  /** Back to idle after a beam or a dropped charge, keeping any transformation. */
  private resetCycle() {
    this.phase = 'idle';
    this.charge = 0;
    this.fireCharge = 0;
    this.pump = 0;
    this.hold = 0;
    this.powerHold = 0;
    this.grace = 0;
    this.lost = 0;
    this.cool = 0;
    this.callout = 0;
    this.lastReach = null;
    this.reachDt = 0;
    this.reachVel = 0;
    this.anchor = null;
    this.releaseTime = 0;
    this.moved = 0;
    this.release = 0;
  }

  /**
   * How far the arms have moved out of the charge pose since it was recorded:
   * hands travelling on screen, coming toward the camera, or elbows straightening.
   * Comparing against the player's own charge pose cancels per-person depth bias.
   */
  private motion(a: FormAnalysis): number {
    const k = this.anchor;
    if (!k) return 0;
    const dImg = dist2(a.handsAC, k.hands) / a.torsoLen;
    const dFwd = a.forward - k.forward;
    const dElbow = (a.elbowAvg - k.elbow) / 45;
    this.moved = Math.max(ramp(dImg, 0.3, 0.55), ramp(dFwd, 0.15, 0.32), ramp(dElbow, 0.45, 0.9));
    return this.moved;
  }

  private recordAnchor(a: FormAnalysis) {
    const k = this.anchor;
    if (!k) {
      this.anchor = { hands: { ...a.handsAC }, forward: a.forward, elbow: a.elbowAvg };
      return;
    }
    k.hands = lerp2(k.hands, a.handsAC, 0.15);
    k.forward += 0.15 * (a.forward - k.forward);
    k.elbow += 0.15 * (a.elbowAvg - k.elbow);
  }

  update(dt: number, a: FormAnalysis | null): GestureEvent[] {
    const ev: GestureEvent[] = [];
    const c = CONFIG.charge;
    const f = CONFIG.fire;
    const ss = CONFIG.superSaiyan;
    const chargeP = a?.chargePose ?? 0;
    const powerP = a?.powerUpPose ?? 0;
    if (this.phase !== 'powering') this.ascend = Math.max(0, this.ascend - ss.decay * dt);

    if (a) {
      const target = this.phase === 'firing' ? a.fireQuality : a.chargeQuality;
      this.formScore = damp(this.formScore, target, 4, dt);
    }

    switch (this.phase) {
      case 'idle':
        this.hold = chargeP >= c.startThreshold ? this.hold + dt : Math.max(0, this.hold - dt * 2);
        if (this.hold >= c.holdToStart) {
          if (a) this.recordAnchor(a);
          this.phase = 'charging';
          this.grace = 0;
          this.callout = 0;
          ev.push({ type: 'chargeStart' });
          break;
        }
        this.powerHold = powerP >= ss.startThreshold ? this.powerHold + dt : Math.max(0, this.powerHold - dt * 2);
        if (this.powerHold >= ss.holdToStart) {
          this.phase = 'powering';
          this.lost = 0;
          ev.push({ type: 'powerStart' });
        }
        break;

      case 'powering': {
        // Going straight into the Kamehameha: hand over to idle so the charge can start.
        if (chargeP >= c.startThreshold) {
          this.resetCycle();
          break;
        }
        if (powerP < ss.holdThreshold) {
          this.lost += dt;
          if (this.lost > ss.grace) this.resetCycle();
          break;
        }
        this.lost = 0;
        if (!this.superSaiyan) {
          const stanceBoost = 0.8 + 0.4 * (a?.stance ?? 0.5);
          this.ascend = Math.min(1, this.ascend + (dt / ss.holdToTransform) * (0.7 + 0.3 * powerP) * stanceBoost);
          if (this.ascend >= 1) {
            this.superSaiyan = true;
            this.ascend = 0;
            ev.push({ type: 'transform' });
          }
        }
        break;
      }

      case 'charging': {
        const motion = a ? this.motion(a) : 0;
        // The release is a movement out of the charge pose, hands together at chest height.
        // Moving far from the charge spot also ends the charge pose, even if depth noise
        // still makes it look half-held (otherwise a belly-height thrust could deadlock).
        this.release = a ? Math.min(a.fireTogether, a.fireHeight, motion) : 0;
        const chargeHeld = chargeP >= c.holdThreshold && motion < 0.5;
        const releasing = this.release >= f.startThreshold || (!chargeHeld && (a?.firePose ?? 0) >= f.startThreshold);
        this.releaseTime = releasing ? this.releaseTime + dt : 0;
        if (!this.fireBlocked && this.charge >= f.minCharge && this.releaseTime >= f.confirm) {
          this.phase = 'firing';
          this.fireCharge = this.charge;
          this.lost = 0;
          this.pump = 0;
          this.lastReach = null;
          this.reachDt = 0;
          this.reachVel = 0;
          ev.push({ type: 'fire', charge: this.charge });
          break;
        }
        if (chargeHeld) {
          this.grace = 0;
          // Track the charge pose only while it's clearly held and still.
          if (a && chargeP >= c.startThreshold && motion < 0.25) this.recordAnchor(a);
          const stanceBoost = 0.8 + 0.4 * (a?.stance ?? 0.5);
          const rate = c.rate * (this.superSaiyan ? ss.chargeRate : 1);
          this.charge = Math.min(1, this.charge + rate * dt * (0.6 + 0.4 * chargeP) * stanceBoost);
          while (this.callout < CALLOUTS.length && this.charge >= c.calloutAt[this.callout]) {
            ev.push({ type: 'callout', text: CALLOUTS[this.callout], index: this.callout });
            this.callout++;
          }
          break;
        }
        this.grace += dt;
        if (this.grace > c.grace) this.charge = Math.max(0, this.charge - c.decay * dt);
        if (this.charge <= 0 || this.grace > c.grace + 1.5) {
          if (this.charge > 0.25) ev.push({ type: 'fizzle' });
          this.resetCycle();
        }
        break;
      }

      case 'firing': {
        const hold = a ? Math.max(a.firePose, Math.min(a.fireTogether, a.fireHeight, Math.max(this.motion(a), a.extension))) : 0;
        this.lost = hold >= f.holdThreshold ? 0 : this.lost + dt;
        this.updatePump(dt, a);
        if (this.drain) this.charge = Math.max(0, this.charge - f.drain * dt);
        if (this.lost > f.breakGrace || this.charge <= 0) this.endFire(ev);
        break;
      }

      case 'cooldown':
        this.cool -= dt;
        if (this.cool <= 0) this.resetCycle();
        break;
    }
    return ev;
  }

  endFire(ev?: GestureEvent[]) {
    if (this.phase !== 'firing') return;
    ev?.push({ type: 'fireEnd' });
    this.phase = 'cooldown';
    this.cool = CONFIG.fire.cooldown;
    this.charge = 0;
    this.pump = 0;
  }

  private updatePump(dt: number, a: FormAnalysis | null) {
    const p = CONFIG.pump;
    this.pump *= Math.exp(-p.decay * dt);
    this.reachDt += dt;
    // The camera (~30fps) is slower than the render loop, so only measure on new detections.
    if (a && a.reach !== this.lastReach) {
      if (this.lastReach !== null && this.reachDt > 0) {
        const v = (a.reach - this.lastReach) / this.reachDt;
        this.reachVel += 0.5 * (v - this.reachVel);
        if (this.reachVel > p.minVelocity) this.pump += (this.reachVel - p.minVelocity) * p.gain * this.reachDt;
      }
      this.lastReach = a.reach;
      this.reachDt = 0;
    }
    this.pump = Math.min(p.max, this.pump);
  }
}
