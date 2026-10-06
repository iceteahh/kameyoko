import type { V3 } from '../types';

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

/** One Euro filter: smooth when still, responsive when moving fast. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;

  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff: number,
  ) {}

  filter(v: number, dt: number): number {
    if (this.x === null) {
      this.x = v;
      return v;
    }
    const rawDx = (v - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }
}

export class PointsFilter {
  private filters: OneEuro[][] = [];

  constructor(private params: { minCutoff: number; beta: number; dCutoff: number }) {}

  filter(points: V3[], dt: number): V3[] {
    const { minCutoff, beta, dCutoff } = this.params;
    return points.map((p, i) => {
      const f = (this.filters[i] ??= [0, 1, 2].map(() => new OneEuro(minCutoff, beta, dCutoff)));
      return { x: f[0].filter(p.x, dt), y: f[1].filter(p.y, dt), z: f[2].filter(p.z, dt) };
    });
  }

  reset() {
    this.filters = [];
  }
}
