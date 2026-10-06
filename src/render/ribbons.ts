import * as THREE from 'three';
import type { RGB, V2 } from '../types';
import { additive } from './primitives';
import { RIBBON_FRAG, RIBBON_VERT } from './shaders';

/** Batched glowing line segments (lightning, helix strands, speed lines). */
export class Ribbons {
  private n = 0;
  private geometry = new THREE.BufferGeometry();
  private pos: THREE.BufferAttribute;
  private side: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;

  constructor(scene: THREE.Scene, private max = 6000) {
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.side = new THREE.BufferAttribute(new Float32Array(max * 4), 1);
    this.col = new THREE.BufferAttribute(new Float32Array(max * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const sides = this.side.array as Float32Array;
    const index = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      sides.set([-1, 1, -1, 1], i * 4);
      const v = i * 4;
      index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('aSide', this.side);
    this.geometry.setAttribute('aColor', this.col);
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(this.geometry, additive({ vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    scene.add(mesh);
  }

  begin() {
    this.n = 0;
  }

  segment(a: V2, b: V2, w0: number, w1: number, c: RGB, intensity: number) {
    if (this.n >= this.max) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-3) return;
    const nx = -dy / l;
    const ny = dx / l;
    const p = this.pos.array as Float32Array;
    const col = this.col.array as Float32Array;
    const o = this.n * 12;
    p.set([a.x + nx * w0, a.y + ny * w0, 0, a.x - nx * w0, a.y - ny * w0, 0, b.x + nx * w1, b.y + ny * w1, 0, b.x - nx * w1, b.y - ny * w1, 0], o);
    const r = c[0] * intensity;
    const g = c[1] * intensity;
    const bl = c[2] * intensity;
    col.set([r, g, bl, r, g, bl, r, g, bl, r, g, bl], o);
    this.n++;
  }

  polyline(points: V2[], width: number, c: RGB, intensity: number, taper = false) {
    for (let i = 0; i < points.length - 1; i++) {
      const w0 = taper ? width * (1 - i / (points.length - 1)) : width;
      const w1 = taper ? width * (1 - (i + 1) / (points.length - 1)) : width;
      this.segment(points[i], points[i + 1], Math.max(w0, 0.5), Math.max(w1, 0.5), c, intensity);
    }
  }

  end() {
    this.geometry.setDrawRange(0, this.n * 6);
    for (const a of [this.pos, this.col]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * 12);
      a.needsUpdate = true;
    }
  }
}

/** Jagged lightning path between two points via midpoint displacement. */
export function lightningPath(a: V2, b: V2, roughness: number, depth = 5): V2[] {
  let pts: V2[] = [a, b];
  let offset = Math.hypot(b.x - a.x, b.y - a.y) * roughness;
  for (let d = 0; d < depth; d++) {
    const next: V2[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const l = Math.hypot(dx, dy) || 1;
      const s = (Math.random() * 2 - 1) * offset;
      next.push({ x: (p.x + q.x) / 2 + (-dy / l) * s, y: (p.y + q.y) / 2 + (dx / l) * s }, q);
    }
    pts = next;
    offset *= 0.5;
  }
  return pts;
}
