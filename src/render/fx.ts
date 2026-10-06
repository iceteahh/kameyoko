import type * as THREE from 'three';
import { CONFIG } from '../config';
import type { Beam, Game, GameEvent, PlayerCtx } from '../game/game';
import type { GestureEvent } from '../gesture/controller';
import type { Layout } from '../layout';
import { clamp, easeOutCubic, lerp, perp2, rand, rayToRectEdge } from '../math';
import type { PlayerId, RGB, V2 } from '../types';
import type { PostParams } from './renderer';
import { Particles } from './particles';
import { BeamPool, OrbPool, RingPool } from './primitives';
import { lightningPath, Ribbons } from './ribbons';

const WHITE: RGB = [1, 1, 1];
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const color = (i: PlayerId) => CONFIG.colors.players[i];

interface Shock {
  at: V2;
  r0: number;
  r1: number;
  t: number;
  dur: number;
  color: RGB;
  thick: number;
  intensity: number;
}

interface Explosion {
  at: V2;
  t: number;
  dur: number;
  radius: number;
  glow: RGB;
}

interface Streak {
  angle: number;
  r: number;
  speed: number;
  len: number;
  width: number;
  owner: PlayerId;
}

export class Effects {
  private orbs: OrbPool;
  private beams: BeamPool;
  private rings: RingPool;
  private particles: Particles;
  private ribbons: Ribbons;
  private shocks: Shock[] = [];
  private explosions: Explosion[] = [];
  private streaks: Streak[] = [];
  private spawnAcc = new Map<string, number>();
  private seeds = [Math.random() * 100, Math.random() * 100];
  private trauma = 0;
  private flash = 0;
  private dim = 0;
  private tint = 0;
  private tintColor: RGB = [0, 0, 0];
  private time = 0;
  private lastClashRing = 0;

  constructor(scene: THREE.Scene, private layout: Layout, pixelRatio: number) {
    this.orbs = new OrbPool(scene);
    this.beams = new BeamPool(scene);
    this.rings = new RingPool(scene);
    this.particles = new Particles(scene);
    this.particles.material.uniforms.uPixelRatio.value = pixelRatio;
    this.ribbons = new Ribbons(scene);
  }

  get particleCount() {
    return this.particles.count;
  }

  /** Emit `rate` per second, carrying fractional spawns across frames. */
  private emit(key: string, rate: number, dt: number, fn: () => void) {
    let acc = (this.spawnAcc.get(key) ?? 0) + rate * dt;
    while (acc >= 1) {
      fn();
      acc -= 1;
    }
    this.spawnAcc.set(key, acc);
  }

  private shock(at: V2, r1: number, colorRGB: RGB, dur = 0.6, intensity = 1.2, thick = 10) {
    this.shocks.push({ at, r0: r1 * 0.1, r1, t: 0, dur, color: colorRGB, thick, intensity });
  }

  private burst(at: V2, n: number, speed: number, colors: RGB[], size = 10, life = 0.9) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.2 + Math.random());
      this.particles.spawn({
        x: at.x,
        y: at.y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life * rand(0.5, 1.2),
        size: size * rand(0.5, 1.4),
        color: colors[i % colors.length],
        drag: 2.2,
        gravity: 120,
      });
    }
  }

  onGesture(i: PlayerId, e: GestureEvent, players: [PlayerCtx, PlayerCtx]) {
    const a = players[i].analysis;
    if (!a) return;
    const at = this.layout.toScreen(a.handsCenter);
    if (e.type === 'chargeStart') this.shock(at, this.layout.height * 0.12, color(i).glow, 0.5, 0.8, 6);
    if (e.type === 'callout') this.shock(at, this.layout.height * (0.1 + e.index * 0.03), color(i).glow, 0.45, 0.7, 5);
    if (e.type === 'fizzle') this.burst(at, 40, 300, [color(i).glow], 6, 0.5);
  }

  onGame(e: GameEvent) {
    const H = this.layout.height;
    switch (e.type) {
      case 'fire': {
        const c = color(e.player);
        this.flash = Math.max(this.flash, e.mode === 'camera' ? 0.55 : 0.2);
        this.trauma = Math.min(1, this.trauma + (e.mode === 'camera' ? 0.7 : 0.35));
        this.shock(e.at, H * 0.3, c.glow, 0.5, 1.4, 12);
        this.burst(e.at, 80, 700, [c.glow, c.core], 9, 0.6);
        break;
      }
      case 'clash':
        this.flash = Math.max(this.flash, 0.45);
        this.trauma = Math.min(1, this.trauma + 0.6);
        this.shock(e.at, H * 0.45, WHITE, 0.7, 1.5, 16);
        this.shock(e.at, H * 0.3, WHITE, 0.5, 1.0, 8);
        this.burst(e.at, 160, 900, [color(0).glow, color(1).glow, WHITE], 10, 0.8);
        break;
      case 'ko': {
        const c = color(e.winner);
        this.flash = 0.9;
        this.trauma = 1;
        this.shock(e.at, H * 0.8, WHITE, 1.0, 2.0, 22);
        this.shock(e.at, H * 0.55, c.glow, 0.8, 1.6, 14);
        this.shock(e.at, H * 0.35, c.core, 0.6, 1.2, 10);
        this.burst(e.at, 500, 1300, [c.glow, c.core, WHITE, [1, 0.5, 0.15]], 14, 1.4);
        this.explosions.push({ at: e.at, t: 0, dur: 1.6, radius: H * 0.18, glow: c.glow });
        break;
      }
      case 'edge':
        this.trauma = Math.min(1, this.trauma + 0.3);
        this.shock(e.at, H * 0.35, color(e.player).glow, 0.6, 1.3, 14);
        break;
      default:
        break;
    }
  }

  update(dt: number, time: number, players: [PlayerCtx, PlayerCtx], game: Game) {
    this.time = time;
    const H = this.layout.height;
    this.orbs.begin();
    this.beams.begin();
    this.rings.begin();
    this.ribbons.begin();

    let anyCharging = false;
    let anyBeam = false;
    let tintTarget = 0;
    let tintColor: RGB = [0, 0, 0];

    players.forEach((p, idx) => {
      const i = idx as PlayerId;
      const a = p.analysis;
      if (!p.present || !a) return;
      const c = color(i);
      const hands = this.layout.toScreen(a.handsCenter);
      const ctrl = p.ctrl;

      // Rising aura around the body while powering up.
      if (ctrl.phase === 'charging' || ctrl.phase === 'firing') {
        const box = a.box;
        const p0 = this.layout.toScreen({ x: box.x0, y: box.y0 });
        const p1 = this.layout.toScreen({ x: box.x1, y: box.y1 });
        const level = ctrl.phase === 'firing' ? 0.8 : ctrl.charge;
        this.emit(`aura${i}`, 30 + 160 * level, dt, () => {
          this.particles.spawn({
            x: rand(p0.x, p1.x),
            y: rand(lerp(p0.y, p1.y, 0.3), p1.y),
            vx: rand(-20, 20),
            vy: -rand(120, 320) * (0.5 + level),
            life: rand(0.4, 0.9),
            size: rand(6, 16),
            color: mix(c.glow, c.core, Math.random() * 0.4),
            drag: 0.6,
          });
        });
      }

      if (ctrl.phase === 'charging' && ctrl.charge > 0) {
        anyCharging = true;
        const q = ctrl.charge;
        const radius = H * (0.012 + 0.05 * q) * (1 + 0.06 * Math.sin(time * 30));
        this.orbs.draw({ at: hands, radius, glow: c.glow, core: c.core, intensity: 0.5 + 0.9 * q, turb: 0.4 + q, seed: this.seeds[i], time });
        this.emit(`charge${i}`, 40 + 260 * q, dt, () => {
          const ang = Math.random() * Math.PI * 2;
          const r = radius * rand(3, 6);
          const tangent = (Math.random() < 0.5 ? -1 : 1) * rand(80, 200);
          this.particles.spawn({
            x: hands.x + Math.cos(ang) * r,
            y: hands.y + Math.sin(ang) * r,
            vx: -Math.sin(ang) * tangent,
            vy: Math.cos(ang) * tangent,
            life: 0.8,
            size: rand(4, 10),
            color: mix(c.glow, c.core, Math.random() * 0.6),
            drag: 1.5,
            attract: { x: hands.x, y: hands.y, strength: 2200 + 2500 * q },
          });
        });
        if (q > 0.55 && Math.random() < q * 0.6) {
          const ang = Math.random() * Math.PI * 2;
          const r = radius * rand(1.5, 3.2);
          const end = { x: hands.x + Math.cos(ang) * r, y: hands.y + Math.sin(ang) * r };
          this.ribbons.polyline(lightningPath(hands, end, 0.35, 4), 2.2, c.glow, 1.4, true);
        }
        tintTarget = Math.max(tintTarget, 0.12 * q);
        tintColor = c.glow;
      }
    });

    for (const b of game.beams) {
      if (b.alpha < 0.01) continue;
      anyBeam = true;
      if (b.mode === 'camera') this.drawCameraBeam(b, dt);
      else this.drawSideBeam(b, dt, game);
      tintTarget = Math.max(tintTarget, 0.3 * b.alpha);
      tintColor = color(b.owner).glow;
    }

    const s = game.struggle;
    if (s.active) this.drawClash(dt, game);

    for (const e of this.explosions) {
      e.t += dt;
      const k = e.t / e.dur;
      this.orbs.draw({
        at: e.at,
        radius: e.radius * easeOutCubic(k * 1.5) * 1.6,
        glow: mix(e.glow, [1, 0.5, 0.15], 0.4),
        core: WHITE,
        intensity: 2.2 * (1 - k) * (1 - k),
        turb: 2,
        seed: 7,
        time,
      });
    }
    this.explosions = this.explosions.filter((e) => e.t < e.dur);

    for (const sh of this.shocks) {
      sh.t += dt;
      const k = sh.t / sh.dur;
      this.rings.draw({
        at: sh.at,
        radius: lerp(sh.r0, sh.r1, easeOutCubic(k)),
        thickness: sh.thick * (1 - k * 0.6),
        color: sh.color,
        intensity: sh.intensity * (1 - k),
      });
    }
    this.shocks = this.shocks.filter((sh) => sh.t < sh.dur);

    this.particles.update(dt);
    this.orbs.end();
    this.beams.end();
    this.rings.end();
    this.ribbons.end();

    const dimTarget = s.active ? 0.45 : anyBeam ? 0.3 : anyCharging ? 0.15 : 0;
    this.dim = lerp(this.dim, dimTarget, 1 - Math.exp(-4 * dt));
    this.tint = lerp(this.tint, tintTarget, 1 - Math.exp(-4 * dt));
    this.tintColor = tintColor;
    this.flash *= Math.exp(-5 * dt);
    this.trauma = Math.max(0, this.trauma - dt * 0.9);
  }

  private drawSideBeam(b: Beam, dt: number, game: Game) {
    const c = color(b.owner);
    const t = this.time;
    const power = b.alpha * (1 + 0.08 * Math.sin(t * 40 + b.owner));
    const end = { x: b.origin.x + b.dir.x * b.length, y: b.origin.y + b.dir.y * b.length };
    const n = perp2(b.dir);

    this.beams.draw({ origin: b.origin, dir: b.dir, length: b.length, width: b.width, glow: c.glow, core: c.core, power, seed: this.seeds[b.owner], time: t });
    this.orbs.draw({ at: b.origin, radius: b.width * 0.65, glow: c.glow, core: c.core, intensity: 1.2 * b.alpha, turb: 1, seed: this.seeds[b.owner], time: t });
    if (!game.struggle.active && !b.edgeHit && b.active) {
      this.orbs.draw({ at: end, radius: b.width * 0.85, glow: c.glow, core: c.core, intensity: 1.3 * b.alpha, turb: 1.4, seed: this.seeds[b.owner] + 3, time: t });
    }

    // Two energy strands twisting around the beam.
    if (b.length > b.width) {
      for (const phase of [0, Math.PI]) {
        const pts: V2[] = [];
        const steps = Math.max(8, Math.floor(b.length / 18));
        for (let k = 0; k <= steps; k++) {
          const u = (k / steps) * b.length;
          const off = Math.sin(u * 0.025 - t * 14 + phase) * b.width * 0.62 * Math.min(1, u / (b.width * 2));
          pts.push({ x: b.origin.x + b.dir.x * u + n.x * off, y: b.origin.y + b.dir.y * u + n.y * off });
        }
        this.ribbons.polyline(pts, 2.5, c.core, 0.5 * b.alpha);
      }
    }

    if (b.active) {
      this.emit(`stream${b.owner}`, 120 + b.length * 0.25, dt, () => {
        const u = Math.random() * b.length;
        const side = (Math.random() * 2 - 1) * b.width * 0.7;
        const sp = rand(400, 900);
        this.particles.spawn({
          x: b.origin.x + b.dir.x * u + n.x * side,
          y: b.origin.y + b.dir.y * u + n.y * side,
          vx: b.dir.x * sp + n.x * side * 2,
          vy: b.dir.y * sp + n.y * side * 2,
          life: rand(0.2, 0.45),
          size: rand(4, 9),
          color: mix(c.glow, c.core, Math.random()),
          drag: 1,
        });
      });
    }

    if (b.edgeHit && b.active) {
      const d = rayToRectEdge(b.origin, b.dir, this.layout.width, this.layout.height, 0);
      const at = { x: b.origin.x + b.dir.x * d, y: b.origin.y + b.dir.y * d };
      this.trauma = Math.max(this.trauma, 0.25);
      this.orbs.draw({ at, radius: b.width * 1.2, glow: c.glow, core: c.core, intensity: 1.4, turb: 1.8, seed: 11, time: t });
      this.emit(`edge${b.owner}`, 260, dt, () => {
        const ang = Math.atan2(-b.dir.y, -b.dir.x) + rand(-1.3, 1.3);
        const sp = rand(300, 1100);
        this.particles.spawn({ x: at.x, y: at.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rand(0.3, 0.7), size: rand(5, 12), color: Math.random() < 0.5 ? c.glow : WHITE, drag: 2, gravity: 500 });
      });
    }
  }

  /** Beam fired toward the camera: the energy rushes at the viewer. */
  private drawCameraBeam(b: Beam, dt: number) {
    const c = color(b.owner);
    const { width: W, height: H } = this.layout;
    const t = this.time;
    const grow = easeOutCubic(b.age / 0.55);
    // Big enough to feel like it's coming at you, small enough that you stay visible.
    const maxR = Math.hypot(W, H) * 0.11;
    const radius = lerp(b.width * 0.6, maxR, grow) * (1 + 0.06 * Math.sin(t * 25));
    this.orbs.draw({ at: b.origin, radius, glow: c.glow, core: c.core, intensity: 0.85 * b.alpha, turb: 1.6, seed: this.seeds[b.owner], time: t });
    this.orbs.draw({ at: b.origin, radius: radius * 0.4, glow: c.core, core: WHITE, intensity: 0.8 * b.alpha, turb: 0.8, seed: 5, time: t });
    if (b.active && Math.random() < 0.5) {
      const ang = Math.random() * Math.PI * 2;
      const end = { x: b.origin.x + Math.cos(ang) * radius * 2.2, y: b.origin.y + Math.sin(ang) * radius * 2.2 };
      this.ribbons.polyline(lightningPath(b.origin, end, 0.3, 5), 3, c.glow, 1.2, true);
    }
    if (b.active) {
      this.trauma = Math.max(this.trauma, 0.3 + 0.2 * grow);
      this.emit(`streak${b.owner}`, 70, dt, () => {
        this.streaks.push({ angle: Math.random() * Math.PI * 2, r: radius * 0.8, speed: rand(900, 1800), len: rand(60, 200), width: rand(2, 5), owner: b.owner });
      });
    }
    for (const s of this.streaks) {
      if (s.owner !== b.owner) continue;
      s.r += s.speed * dt;
      s.len += s.speed * dt * 0.3;
      const dir = { x: Math.cos(s.angle), y: Math.sin(s.angle) };
      const p0 = { x: b.origin.x + dir.x * s.r, y: b.origin.y + dir.y * s.r };
      const p1 = { x: p0.x + dir.x * s.len, y: p0.y + dir.y * s.len };
      this.ribbons.segment(p0, p1, s.width * 0.3, s.width, c.core, 0.9 * b.alpha);
    }
    const limit = Math.hypot(W, H);
    this.streaks = this.streaks.filter((s) => s.r < limit);
  }

  private drawClash(dt: number, game: Game) {
    const s = game.struggle;
    const t = this.time;
    const [A, B] = game.beams;
    const H = this.layout.height;
    const at = s.point;
    const axis = { x: B.origin.x - A.origin.x, y: B.origin.y - A.origin.y };
    const len = Math.hypot(axis.x, axis.y) || 1;
    const dir = { x: axis.x / len, y: axis.y / len };
    const n = perp2(dir);
    const size = (A.width + B.width) * 0.4 * (1 + 0.12 * Math.sin(t * 22)) * (0.8 + 0.2 * s.intensity);
    const share = s.powers[0] / (s.powers[0] + s.powers[1]);
    const c0 = color(0).glow;
    const c1 = color(1).glow;

    this.orbs.draw({ at, radius: size, glow: mix(c0, c1, 1 - share), core: WHITE, intensity: 1.15, turb: 1.8, seed: 13, time: t });
    this.orbs.draw({ at: { x: at.x - dir.x * size * 0.35, y: at.y - dir.y * size * 0.35 }, radius: size * 0.5, glow: c0, core: color(0).core, intensity: 0.7, turb: 1.4, seed: 17, time: t });
    this.orbs.draw({ at: { x: at.x + dir.x * size * 0.35, y: at.y + dir.y * size * 0.35 }, radius: size * 0.5, glow: c1, core: color(1).core, intensity: 0.7, turb: 1.4, seed: 19, time: t });

    this.emit('clash', 380 * s.intensity, dt, () => {
      const side = Math.random() < 0.5 ? -1 : 1;
      const spread = rand(-0.9, 0.9);
      const vx = n.x * side + dir.x * spread;
      const vy = n.y * side + dir.y * spread;
      const sp = rand(400, 1400) * s.intensity;
      this.particles.spawn({ x: at.x, y: at.y, vx: vx * sp, vy: vy * sp, life: rand(0.3, 0.8), size: rand(5, 13), color: Math.random() < 0.5 ? c0 : Math.random() < 0.5 ? c1 : WHITE, drag: 1.8, gravity: 400 });
    });

    for (let k = 0; k < 3; k++) {
      const ang = Math.atan2(n.y, n.x) + (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.8, 0.8);
      const r = size * rand(1.8, 3.5);
      const end = { x: at.x + Math.cos(ang) * r, y: at.y + Math.sin(ang) * r };
      this.ribbons.polyline(lightningPath(at, end, 0.3, 5), 3, Math.random() < 0.5 ? c0 : c1, 1.3, true);
    }

    if (t - this.lastClashRing > 0.4) {
      this.lastClashRing = t;
      this.shock(at, H * 0.25 * s.intensity, WHITE, 0.45, 0.8, 7);
    }
    this.trauma = Math.max(this.trauma, 0.3 + 0.2 * s.intensity);
  }

  post(time: number): { params: PostParams; tint: RGB } {
    const shakeAmp = this.trauma * this.trauma * 22;
    const shake = {
      x: shakeAmp * (Math.sin(time * 61.3) * 0.6 + Math.sin(time * 97.1) * 0.4),
      y: shakeAmp * (Math.sin(time * 73.7 + 1.1) * 0.6 + Math.sin(time * 89.3) * 0.4),
    };
    return {
      params: {
        shake,
        flash: clamp(this.flash, 0, 1),
        dim: this.dim,
        aberration: 0.002 + this.trauma * 0.014,
        tint: this.tint,
        time,
      },
      tint: this.tintColor,
    };
  }
}
