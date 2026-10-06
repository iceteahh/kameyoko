import { describe, expect, it } from 'vitest';
import { buildWorldPose, toPoseFrame } from '../src/demo/skeleton';
import { OneEuro } from '../src/tracking/oneEuro';
import { Tracker } from '../src/tracking/tracker';
import type { HandFrame } from '../src/types';

const pose = (cx: number) => toPoseFrame(buildWorldPose('idle'), { facing: 1, cx });

describe('Tracker', () => {
  it('assigns the left person to P1 and the right person to P2', () => {
    const t = new Tracker();
    t.update({ poses: [pose(0.8), pose(0.2)], hands: [] }, 0, 16 / 9);
    expect(t.slots[0].hipX).toBeCloseTo(0.2, 1);
    expect(t.slots[1].hipX).toBeCloseTo(0.8, 1);
  });

  it('keeps identities stable while people move', () => {
    const t = new Tracker();
    let a = 0.3;
    let b = 0.7;
    t.update({ poses: [pose(a), pose(b)], hands: [] }, 0, 16 / 9);
    // Both drift right; P1 ends up nearer P2's starting side but keeps its slot.
    for (let k = 1; k <= 30; k++) {
      a += 0.01;
      b += 0.007;
      t.update({ poses: [pose(b), pose(a)], hands: [] }, k / 30, 16 / 9);
    }
    expect(t.slots[0].hipX).toBeCloseTo(0.6, 1);
    expect(t.slots[1].hipX).toBeCloseTo(0.91, 1);
  });

  it('releases a slot after the person leaves', () => {
    const t = new Tracker();
    t.update({ poses: [pose(0.3)], hands: [] }, 0, 16 / 9);
    expect(t.slots[0].present).toBe(true);
    t.update({ poses: [], hands: [] }, 0.3, 16 / 9);
    expect(t.slots[0].present).toBe(true);
    t.update({ poses: [], hands: [] }, 1.0, 16 / 9);
    expect(t.slots[0].present).toBe(false);
  });

  it('only tracks one person in single-player mode', () => {
    const t = new Tracker();
    t.maxPlayers = 1;
    t.update({ poses: [pose(0.3), pose(0.7)], hands: [] }, 0, 16 / 9);
    expect(t.slots[0].present).toBe(true);
    expect(t.slots[1].present).toBe(false);
  });

  it('attaches hands to the nearest wrist', () => {
    const t = new Tracker();
    const p = pose(0.3);
    const hand = (wrist: { x: number; y: number }): HandFrame => ({
      image: Array.from({ length: 21 }, () => ({ x: wrist.x, y: wrist.y, z: 0 })),
      world: Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })),
      score: 1,
    });
    t.update({ poses: [p], hands: [hand(p.image[15]), hand(p.image[16]), hand({ x: 0.9, y: 0.1 })] }, 0, 16 / 9);
    const hands = t.slots[0].frame!.hands;
    expect(hands.map((h) => h.side).sort()).toEqual([0, 1]);
  });
});

describe('OneEuro', () => {
  it('converges on a constant signal and smooths jitter', () => {
    const f = new OneEuro(1.4, 4, 1);
    let out = 0;
    for (let i = 0; i < 120; i++) out = f.filter(1 + (i % 2 ? 0.01 : -0.01), 1 / 30);
    expect(Math.abs(out - 1)).toBeLessThan(0.01);
  });
});
