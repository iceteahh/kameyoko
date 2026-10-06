import { describe, expect, it } from 'vitest';
import { buildWorldPose } from '../src/demo/skeleton';
import { GestureController, type GestureEvent } from '../src/gesture/controller';
import type { V3 } from '../src/types';
import { analyse, facingCamera, inflateElbows, noisy, realistic, rng } from './helpers';

function run(ctrl: GestureController, a: ReturnType<typeof analyse>, seconds: number, dt = 1 / 30) {
  const out: GestureEvent[] = [];
  for (let t = 0; t < seconds; t += dt) out.push(...ctrl.update(dt, a));
  return out;
}

describe('real-camera style data (depth underestimated toward the lens)', () => {
  it('the squashed thrust really does read as bent elbows (the bug)', () => {
    const a = realistic('fire');
    expect(a.chargePose).toBeLessThan(0.4);
  });

  it('recognises the power-up stance facing the camera, even with noisy arms', () => {
    expect(realistic('powerup').powerUpPose).toBeGreaterThan(0.7);
    for (const name of ['idle', 'charge', 'fire'] as const) expect(realistic(name).powerUpPose).toBeLessThan(0.3);
    const rand = rng(7);
    const c = new GestureController();
    const ev: GestureEvent[] = [];
    for (let t = 0; t < 4; t += 1 / 30) ev.push(...c.update(1 / 30, analyse(noisy(facingCamera(buildWorldPose('powerup')), 0.04, rand))));
    expect(ev.some((e) => e.type === 'transform')).toBe(true);
  });

  it('fires when releasing into a thrust toward the camera', () => {
    const c = new GestureController();
    run(c, realistic('charge'), 2.5);
    expect(c.phase).toBe('charging');
    const ev = run(c, realistic('fire'), 0.5);
    expect(ev.some((e) => e.type === 'fire')).toBe(true);
    expect(c.phase).toBe('firing');
  });

  it('fires when thrusting at belly height (no deadlock with the charge pose)', () => {
    const c = new GestureController();
    run(c, realistic('charge'), 2.5);
    const ev = run(c, realistic('fire', { lowerHands: 0.22 }), 0.5);
    expect(ev.some((e) => e.type === 'fire')).toBe(true);
  });

  it('keeps the beam alive while holding the squashed thrust', () => {
    const c = new GestureController();
    run(c, realistic('charge'), 2.5);
    run(c, realistic('fire'), 0.3);
    const ev = run(c, realistic('fire'), 2);
    expect(ev.some((e) => e.type === 'fireEnd')).toBe(false);
    expect(c.phase).toBe('firing');
  });

  it('never fires while still holding the charge pose', () => {
    const c = new GestureController();
    const ev = run(c, realistic('charge'), 4);
    expect(ev.some((e) => e.type === 'fire')).toBe(false);
  });

  it('does not fire from a relaxed standing pose after charging', () => {
    const c = new GestureController();
    run(c, realistic('charge'), 2.5);
    const ev = run(c, realistic('idle'), 1);
    expect(ev.some((e) => e.type === 'fire')).toBe(false);
  });
});

describe('no early release while charging (noisy, badly estimated elbows)', () => {
  const variants: [string, () => V3[]][] = [
    ['hip charge, facing camera', () => facingCamera(buildWorldPose('charge'))],
    ['belly charge, facing camera', () => facingCamera(buildWorldPose('chargeFront'), { wristZ: 1, elbowZ: 1 })],
    ['belly charge, profile', () => buildWorldPose('chargeFront')],
    ['hip charge, profile', () => buildWorldPose('charge')],
  ];
  for (const [label, make] of variants) {
    for (const inflate of [0, 0.5, 0.7]) {
      it(`${label}, elbow error ${inflate}`, () => {
        const rand = rng(42);
        const base = inflateElbows(make(), inflate);
        const c = new GestureController();
        const ev: GestureEvent[] = [];
        for (let t = 0; t < 5; t += 1 / 30) ev.push(...c.update(1 / 30, analyse(noisy(base, 0.03, rand))));
        expect(ev.some((e) => e.type === 'fire')).toBe(false);
      });
    }
  }

  it('still fires after a noisy belly charge followed by a thrust', () => {
    const rand = rng(7);
    const c = new GestureController();
    const charge = inflateElbows(facingCamera(buildWorldPose('chargeFront'), { wristZ: 1, elbowZ: 1 }), 0.5);
    for (let t = 0; t < 2.5; t += 1 / 30) c.update(1 / 30, analyse(noisy(charge, 0.03, rand)));
    const ev: GestureEvent[] = [];
    for (let t = 0; t < 0.6; t += 1 / 30) ev.push(...c.update(1 / 30, analyse(noisy(facingCamera(buildWorldPose('fire')), 0.03, rand))));
    expect(ev.some((e) => e.type === 'fire')).toBe(true);
  });
});
