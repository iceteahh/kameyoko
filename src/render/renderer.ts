import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Layout } from '../layout';
import type { RGB, V2 } from '../types';
import { COMPOSITE_FRAG, QUAD_VERT } from './shaders';

export interface PostParams {
  shake: V2;
  flash: number;
  dim: number;
  aberration: number;
  tint: number;
  time: number;
}

/**
 * Effects are drawn on black into an HDR target, bloomed, then composited
 * additively over the camera feed so only the energy glows (not the room).
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
  readonly pixelRatio: number;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private composite: ShaderPass;
  private videoTexture: THREE.VideoTexture | null = null;

  constructor(canvas: HTMLCanvasElement, private layout: Layout) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.0);
    this.composer.addPass(this.bloom);
    this.composite = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        tVideo: { value: null },
        uHasVideo: { value: 0 },
        uVideoMap: { value: new THREE.Vector4(1, 1, 1, 0) },
        uShake: { value: new THREE.Vector2() },
        uFlash: { value: 0 },
        uDim: { value: 0 },
        uAberration: { value: 0 },
        uTint: { value: new THREE.Vector3() },
        uTime: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
    });
    this.composer.addPass(this.composite);
  }

  setVideo(video: HTMLVideoElement | null) {
    this.videoTexture?.dispose();
    this.videoTexture = video ? new THREE.VideoTexture(video) : null;
    if (this.videoTexture) {
      this.videoTexture.minFilter = THREE.LinearFilter;
      this.videoTexture.magFilter = THREE.LinearFilter;
      this.videoTexture.generateMipmaps = false;
    }
    this.composite.uniforms.tVideo.value = this.videoTexture;
    this.composite.uniforms.uHasVideo.value = video ? 1 : 0;
  }

  resize() {
    const { width, height } = this.layout;
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width * this.pixelRatio * 0.5, height * this.pixelRatio * 0.5);
    // y-down pixel space to match screen/DOM coordinates.
    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = 0;
    this.camera.bottom = height;
    this.camera.updateProjectionMatrix();
  }

  render(p: PostParams, tintColor: RGB) {
    const u = this.composite.uniforms;
    (u.uVideoMap.value as THREE.Vector4).set(...this.layout.videoUvMap());
    (u.uShake.value as THREE.Vector2).set(p.shake.x / this.layout.width, -p.shake.y / this.layout.height);
    u.uFlash.value = p.flash;
    u.uDim.value = p.dim;
    u.uAberration.value = p.aberration;
    (u.uTint.value as THREE.Vector3).set(tintColor[0] * p.tint, tintColor[1] * p.tint, tintColor[2] * p.tint);
    u.uTime.value = p.time;
    this.composer.render();
  }
}
