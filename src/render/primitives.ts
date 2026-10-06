import * as THREE from 'three';
import type { RGB, V2 } from '../types';
import { BEAM_FRAG, ORB_FRAG, QUAD_VERT, RING_FRAG } from './shaders';

export function additive(params: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    ...params,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Immediate-mode pool: call begin(), draw what you need this frame, then end(). */
abstract class QuadPool {
  private meshes: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
  private used = 0;

  constructor(
    private scene: THREE.Scene,
    private geometry: THREE.BufferGeometry,
    private material: THREE.ShaderMaterial,
    private renderOrder: number,
  ) {}

  begin() {
    this.used = 0;
  }

  end() {
    for (let i = this.used; i < this.meshes.length; i++) this.meshes[i].visible = false;
  }

  protected next() {
    let m = this.meshes[this.used];
    if (!m) {
      m = new THREE.Mesh(this.geometry, this.material.clone());
      m.frustumCulled = false;
      m.renderOrder = this.renderOrder;
      this.scene.add(m);
      this.meshes.push(m);
    }
    m.visible = true;
    this.used++;
    return m;
  }
}

const setRGB = (u: THREE.IUniform, c: RGB) => (u.value as THREE.Vector3).set(c[0], c[1], c[2]);

export class OrbPool extends QuadPool {
  constructor(scene: THREE.Scene) {
    super(
      scene,
      new THREE.PlaneGeometry(1, 1),
      additive({
        vertexShader: QUAD_VERT,
        fragmentShader: ORB_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 1 },
          uSeed: { value: 0 },
          uTurb: { value: 1 },
          uGlow: { value: new THREE.Vector3() },
          uCore: { value: new THREE.Vector3() },
        },
      }),
      3,
    );
  }

  /** `radius` is the visible ball radius; the glow halo extends ~3.3x beyond it. */
  draw(o: { at: V2; radius: number; glow: RGB; core: RGB; intensity: number; turb: number; seed: number; time: number }) {
    if (o.radius <= 0.5 || o.intensity <= 0.001) return;
    const m = this.next();
    const size = (o.radius / 0.3) * 2;
    m.position.set(o.at.x, o.at.y, 0);
    m.scale.set(size, size, 1);
    const u = m.material.uniforms;
    u.uTime.value = o.time;
    u.uIntensity.value = o.intensity;
    u.uSeed.value = o.seed;
    u.uTurb.value = o.turb;
    setRGB(u.uGlow, o.glow);
    setRGB(u.uCore, o.core);
  }
}

export class BeamPool extends QuadPool {
  static readonly HALO = 2.6;

  constructor(scene: THREE.Scene) {
    super(
      scene,
      new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0),
      additive({
        vertexShader: QUAD_VERT,
        fragmentShader: BEAM_FRAG,
        uniforms: {
          uLength: { value: 1 },
          uWidth: { value: 1 },
          uHalo: { value: 1 },
          uTime: { value: 0 },
          uPower: { value: 1 },
          uSeed: { value: 0 },
          uGlow: { value: new THREE.Vector3() },
          uCore: { value: new THREE.Vector3() },
        },
      }),
      2,
    );
  }

  draw(o: { origin: V2; dir: V2; length: number; width: number; glow: RGB; core: RGB; power: number; seed: number; time: number }) {
    if (o.length < 2 || o.power <= 0.001) return;
    const m = this.next();
    const halo = o.width * BeamPool.HALO;
    m.position.set(o.origin.x, o.origin.y, 0);
    m.rotation.z = Math.atan2(o.dir.y, o.dir.x);
    m.scale.set(o.length, halo, 1);
    const u = m.material.uniforms;
    u.uLength.value = o.length;
    u.uWidth.value = o.width;
    u.uHalo.value = halo;
    u.uTime.value = o.time;
    u.uPower.value = o.power;
    u.uSeed.value = o.seed;
    setRGB(u.uGlow, o.glow);
    setRGB(u.uCore, o.core);
  }
}

export class RingPool extends QuadPool {
  constructor(scene: THREE.Scene) {
    super(
      scene,
      new THREE.PlaneGeometry(1, 1),
      additive({
        vertexShader: QUAD_VERT,
        fragmentShader: RING_FRAG,
        uniforms: {
          uIntensity: { value: 1 },
          uThick: { value: 0.05 },
          uColor: { value: new THREE.Vector3() },
        },
      }),
      1,
    );
  }

  draw(o: { at: V2; radius: number; thickness: number; color: RGB; intensity: number }) {
    if (o.radius < 1 || o.intensity <= 0.001) return;
    const m = this.next();
    const size = (o.radius / 0.8) * 2;
    m.position.set(o.at.x, o.at.y, 0);
    m.scale.set(size, size, 1);
    const u = m.material.uniforms;
    u.uIntensity.value = o.intensity;
    u.uThick.value = Math.max(0.01, o.thickness / (size / 2));
    setRGB(u.uColor, o.color);
  }
}
