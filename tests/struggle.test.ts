import { describe, expect, it } from 'vitest';
import { stepStruggle, strugglePower } from '../src/game/struggle';

function simulate(pa: number, pb: number, seconds = 30) {
  let s = { t: 0.5, vel: 0, time: 0 };
  for (let t = 0; t < seconds; t += 1 / 60) {
    const r = stepStruggle(s, pa, pb, 1 / 60);
    s = r.state;
    if (r.loser !== null) return { loser: r.loser, time: t };
  }
  return { loser: null, time: seconds };
}

describe('beam struggle', () => {
  it('the stronger side pushes the clash into the weaker player', () => {
    expect(simulate(1.6, 1.0).loser).toBe(1);
    expect(simulate(1.0, 1.6).loser).toBe(0);
  });

  it('a big power gap ends faster than a close fight', () => {
    expect(simulate(3, 1).time).toBeLessThan(simulate(1.3, 1).time);
  });

  it('an even fight stays balanced', () => {
    expect(simulate(1, 1, 10).loser).toBeNull();
  });

  it('pumping, charge and form all raise power', () => {
    const base = strugglePower(0.5, 0.5, 0);
    expect(strugglePower(1, 0.5, 0)).toBeGreaterThan(base);
    expect(strugglePower(0.5, 1, 0)).toBeGreaterThan(base);
    expect(strugglePower(0.5, 0.5, 1)).toBeGreaterThan(base * 2);
  });
});
