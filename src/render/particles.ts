import * as THREE from 'three';
import type { RGB } from '../types';
import { additive } from './primitives';
import { PARTICLE_FRAG, PARTICLE_VERT } from './shaders';

export interface ParticleSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: RGB;
  drag?: number;
  gravity?: number;
  /** Pull toward a point (used for energy converging into the charge ball). */
  attract?: { x: number; y: number; strength: number };
}

/** CPU-simulated additive point sprites. */
export class Particles {
  private n = 0;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private ax: Float32Array;
  private ay: Float32Array;
  private as: Float32Array;
  private col: Float32Array;
  private geometry = new THREE.BufferGeometry();
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, private max = 5000) {
    const f = () => new Float32Array(max);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.life = f();
    this.maxLife = f();
    this.size = f();
    this.drag = f();
    this.grav = f();
    this.ax = f();
    this.ay = f();
    this.as = f();
    this.col = new Float32Array(max * 3);
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aColor', this.colAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.material = additive({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { uPixelRatio: { value: 1 } },
    });
    const points = new THREE.Points(this.geometry, this.material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    scene.add(points);
  }

  get count() {
    return this.n;
  }

  spawn(p: ParticleSpec) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.x[i] = p.x;
    this.y[i] = p.y;
    this.vx[i] = p.vx;
    this.vy[i] = p.vy;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.size[i] = p.size;
    this.drag[i] = p.drag ?? 0;
    this.grav[i] = p.gravity ?? 0;
    this.ax[i] = p.attract?.x ?? 0;
    this.ay[i] = p.attract?.y ?? 0;
    this.as[i] = p.attract?.strength ?? 0;
    this.col[i * 3] = p.color[0];
    this.col[i * 3 + 1] = p.color[1];
    this.col[i * 3 + 2] = p.color[2];
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      if (this.as[i] > 0) {
        const dx = this.ax[i] - this.x[i];
        const dy = this.ay[i] - this.y[i];
        const d = Math.hypot(dx, dy) + 1;
        if (d < 6) {
          this.kill(i);
          continue;
        }
        this.vx[i] += (dx / d) * this.as[i] * dt;
        this.vy[i] += (dy / d) * this.as[i] * dt;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= k;
      this.vy[i] = this.vy[i] * k + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
    this.sync();
  }

  private kill(i: number) {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.size[i] = this.size[j];
    this.drag[i] = this.drag[j];
    this.grav[i] = this.grav[j];
    this.ax[i] = this.ax[j];
    this.ay[i] = this.ay[j];
    this.as[i] = this.as[j];
    this.col[i * 3] = this.col[j * 3];
    this.col[i * 3 + 1] = this.col[j * 3 + 1];
    this.col[i * 3 + 2] = this.col[j * 3 + 2];
  }

  private sync() {
    const pos = this.posAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;
    const alpha = this.alphaAttr.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const t = this.life[i] / this.maxLife[i];
      pos[i * 3] = this.x[i];
      pos[i * 3 + 1] = this.y[i];
      pos[i * 3 + 2] = 0;
      col[i * 3] = this.col[i * 3];
      col[i * 3 + 1] = this.col[i * 3 + 1];
      col[i * 3 + 2] = this.col[i * 3 + 2];
      size[i] = this.size[i] * (0.4 + 0.6 * t);
      alpha[i] = Math.min(1, t * 2.5);
    }
    this.geometry.setDrawRange(0, this.n);
    for (const a of [this.posAttr, this.colAttr, this.sizeAttr, this.alphaAttr]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }
}
