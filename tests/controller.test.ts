import { describe, expect, it } from 'vitest';
import { buildWorldPose, toPoseFrame, type PoseName } from '../src/demo/skeleton';
import { analyzePose } from '../src/gesture/analyze';
import { GestureController, type GestureEvent } from '../src/gesture/controller';

const analysis = (name: PoseName, pump = 0) =>
  analyzePose({ pose: toPoseFrame(buildWorldPose(name, pump), { facing: 1, cx: 0.3 }), hands: [] }, 16 / 9);

function run(ctrl: GestureController, name: PoseName, seconds: number, dt = 1 / 30): GestureEvent[] {
  const a = analysis(name);
  const out: GestureEvent[] = [];
  for (let t = 0; t < seconds; t += dt) out.push(...ctrl.update(dt, a));
  return out;
}

describe('GestureController', () => {
  it('charges with KA-ME-HA-ME callouts and fires on the thrust', () => {
    const c = new GestureController();
    const charge = run(c, 'charge', 3);
    expect(charge[0]).toEqual({ type: 'chargeStart' });
    expect(charge.filter((e) => e.type === 'callout').map((e) => (e as { text: string }).text)).toEqual(['KA', 'ME', 'HA', 'ME']);
    expect(c.charge).toBeGreaterThan(0.9);

    const fire = run(c, 'fire', 0.2);
    expect(fire.some((e) => e.type === 'fire')).toBe(true);
    expect(c.phase).toBe('firing');
  });

  it('does not fire without charging first', () => {
    const c = new GestureController();
    expect(run(c, 'fire', 1).some((e) => e.type === 'fire')).toBe(false);
    expect(c.phase).toBe('idle');
  });

  it('respects fireBlocked during round intros', () => {
    const c = new GestureController();
    run(c, 'charge', 2);
    c.fireBlocked = true;
    expect(run(c, 'fire', 0.3).some((e) => e.type === 'fire')).toBe(false);
  });

  it('ends the beam when the pose is dropped and when energy runs out', () => {
    const c = new GestureController();
    run(c, 'charge', 3);
    run(c, 'fire', 0.5);
    expect(run(c, 'idle', 1).some((e) => e.type === 'fireEnd')).toBe(true);

    const d = new GestureController();
    run(d, 'charge', 3);
    expect(run(d, 'fire', 8).some((e) => e.type === 'fireEnd')).toBe(true);
  });

  it('does not drain while drain is disabled (struggle)', () => {
    const c = new GestureController();
    run(c, 'charge', 3);
    run(c, 'fire', 0.2);
    c.drain = false;
    const before = c.charge;
    run(c, 'fire', 5);
    expect(c.phase).toBe('firing');
    expect(c.charge).toBeCloseTo(before);
  });

  it('builds pump power from rapid forward thrusts', () => {
    const c = new GestureController();
    run(c, 'charge', 3);
    run(c, 'fire', 0.2);
    const dt = 1 / 30;
    for (let t = 0; t < 2; t += dt) c.update(dt, analysis('fire', 0.045 * (Math.sin(2 * Math.PI * 3 * t) - 0.4)));
    expect(c.pump).toBeGreaterThan(0.2);

    // Same motion sampled at 30fps detections but rendered at 120fps gives the same pump.
    const fast = new GestureController();
    run(fast, 'charge', 3);
    run(fast, 'fire', 0.2);
    let a = analysis('fire');
    for (let k = 0; k < 240; k++) {
      if (k % 4 === 0) a = analysis('fire', 0.045 * (Math.sin(2 * Math.PI * 3 * (k / 120)) - 0.4));
      fast.update(1 / 120, a);
    }
    expect(fast.pump).toBeGreaterThan(c.pump * 0.6);
    expect(fast.pump).toBeLessThan(c.pump * 1.6);

    const still = new GestureController();
    run(still, 'charge', 3);
    run(still, 'fire', 2.2);
    expect(still.pump).toBeLessThan(0.05);
  });
});
