import { describe, expect, it } from 'vitest';
import { blendWorld, buildWorldPose, toPoseFrame } from '../src/demo/skeleton';
import { analyzePose } from '../src/gesture/analyze';
import type { PlayerFrame } from '../src/types';

const frame = (world = buildWorldPose('idle'), facing: 1 | -1 = 1): PlayerFrame => ({
  pose: toPoseFrame(world, { facing, cx: 0.3 }),
  hands: [],
});

describe('analyzePose', () => {
  it('recognises the charge pose (hands cupped at the hip)', () => {
    const a = analyzePose(frame(buildWorldPose('charge')), 16 / 9)!;
    expect(a.chargePose).toBeGreaterThan(0.8);
    expect(a.firePose).toBeLessThan(0.2);
    expect(a.checks.pullBack).toBe(true);
    expect(a.checks.handsTogether).toBe(true);
  });

  it('recognises the fire pose (arms thrust forward)', () => {
    const a = analyzePose(frame(buildWorldPose('fire')), 16 / 9)!;
    expect(a.firePose).toBeGreaterThan(0.8);
    expect(a.chargePose).toBeLessThan(0.2);
    expect(a.checks.thrust).toBe(true);
  });

  it('rejects a neutral standing pose', () => {
    const a = analyzePose(frame(buildWorldPose('idle')), 16 / 9)!;
    expect(a.chargePose).toBeLessThan(0.3);
    expect(a.firePose).toBeLessThan(0.3);
  });

  it('scores a wide bent-knee stance and a narrow one differently', () => {
    expect(analyzePose(frame(buildWorldPose('fire')), 16 / 9)!.stance).toBeGreaterThan(0.6);
    expect(analyzePose(frame(buildWorldPose('idle')), 16 / 9)!.stance).toBeLessThan(0.3);
  });

  it('returns stance=null when the legs are out of frame', () => {
    const f = frame(buildWorldPose('fire'));
    for (const i of [25, 26, 27, 28]) f.pose.vis[i] = 0.1;
    expect(analyzePose(f, 16 / 9)!.stance).toBeNull();
  });

  it('aims the beam toward the facing direction', () => {
    expect(analyzePose(frame(buildWorldPose('fire'), 1), 16 / 9)!.aimDir.x).toBeGreaterThan(0.9);
    expect(analyzePose(frame(buildWorldPose('fire'), -1), 16 / 9)!.aimDir.x).toBeLessThan(-0.9);
  });

  it('detects arms pointed at the camera', () => {
    // Rotate the fire pose so it points toward the lens (-z).
    const world = buildWorldPose('fire').map((p) => ({ x: -p.z, y: p.y, z: -p.x }));
    const a = analyzePose(frame(world), 16 / 9)!;
    expect(a.firePose).toBeGreaterThan(0.6);
    expect(a.towardCamera).toBe(true);
  });

  it('keeps fire pose while pumping the arms in the struggle', () => {
    const retracted = analyzePose(frame(buildWorldPose('fire', -0.03)), 16 / 9)!;
    expect(retracted.firePose).toBeGreaterThan(0.3);
    const mid = analyzePose(frame(blendWorld(buildWorldPose('charge'), buildWorldPose('fire'), 0.5)), 16 / 9)!;
    expect(mid.firePose).toBeLessThan(0.55);
  });

  it('returns null when shoulders are not visible', () => {
    const f = frame();
    f.pose.vis[11] = 0;
    expect(analyzePose(f, 16 / 9)).toBeNull();
  });
});
