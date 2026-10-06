export const NOISE = /* glsl */ `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
`;

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Turbulent energy sphere: used for the charge ball, beam heads, clashes and explosions. */
export const ORB_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uSeed;
uniform float uTurb;
uniform vec3 uGlow;
uniform vec3 uCore;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float n = fbm(p * 3.0 + vec2(uTime * 1.7 + uSeed, -uTime * 1.3));
  float n2 = fbm(p * 6.0 - vec2(uTime * 2.9, uTime * 2.1 + uSeed));
  float rr = r * (1.0 + (n - 0.5) * 0.5 * uTurb);
  const float RB = 0.3;
  float core = smoothstep(RB * 0.8, 0.0, rr);
  float ball = smoothstep(RB * 1.1, RB * 0.5, rr);
  float glow = exp(-max(rr - RB * 0.7, 0.0) * 7.0);
  float a = atan(p.y, p.x + 1e-5);
  float rays = pow(max(0.0, sin(a * 7.0 + uTime * 3.0 + n * 8.0)), 10.0)
             * smoothstep(1.0, RB, r) * smoothstep(0.0, RB * 0.6, r) * uTurb;
  vec3 col = uGlow * (ball * (0.7 + 0.5 * n2) + glow * 0.55 + rays * 0.6) + uCore * core * 1.3;
  col *= uIntensity * smoothstep(1.0, 0.75, r);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Beam body. The quad spans x∈[0,length], y∈[-halo/2, halo/2] in pixels. */
export const BEAM_FRAG = /* glsl */ `
uniform float uLength;
uniform float uWidth;
uniform float uHalo;
uniform float uTime;
uniform float uPower;
uniform float uSeed;
uniform vec3 uGlow;
uniform vec3 uCore;
varying vec2 vUv;
${NOISE}
void main() {
  float x = vUv.x * uLength;
  float y = (vUv.y - 0.5) * uHalo;
  float start = smoothstep(0.0, uWidth * 1.5, x);
  float n = fbm(vec2(x * 0.01 - uTime * 5.0, uSeed + uTime * 0.7));
  float hw = uWidth * 0.5 * mix(0.45, 1.0, start) * (0.82 + 0.36 * n);
  float d = abs(y) / max(hw, 1.0);
  float streak = fbm(vec2(x * 0.015 - uTime * 16.0, y / max(hw, 1.0) * 1.7 + uSeed * 3.0));
  float core = smoothstep(0.45, 0.0, d);
  float body = smoothstep(1.05, 0.5, d);
  float glow = exp(-max(d - 0.9, 0.0) * 1.6) * smoothstep(uHalo * 0.5, uHalo * 0.3, abs(y));
  float endFade = smoothstep(uLength, uLength - uWidth * 0.6, x);
  vec3 col = uGlow * (body * (0.35 + 0.7 * streak) + glow * 0.3) + uCore * core * 0.95;
  gl_FragColor = vec4(col * uPower * endFade, 1.0);
}
`;

/** Super Saiyan aura: a flame envelope around the body with tongues rushing upward. */
export const AURA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uSeed;
uniform vec3 uGlow;
uniform vec3 uCore;
varying vec2 vUv;
${NOISE}
void main() {
  // p.y points up on screen (the camera is y-down).
  vec2 p = vec2(vUv.x * 2.0 - 1.0, 1.0 - vUv.y * 2.0);
  float up = clamp(p.y * 0.5 + 0.5, 0.0, 1.0);
  // Teardrop that narrows toward the top so the flames gather above the head.
  float r = length(vec2(p.x / mix(1.0, 0.5, up * up), p.y));
  float n = fbm(vec2(p.x * 3.0 + uSeed, p.y * 1.5 - uTime * 2.4));
  float tongues = fbm(vec2(p.x * 7.0 - uSeed, p.y * 2.0 - uTime * 4.5));
  float edge = 0.76 + (n - 0.5) * 0.45 + (tongues - 0.5) * 0.5 * up;
  float d = r - edge;
  // Bright flickering edge, sparse flame tongues inside, and a see-through middle so the player stays visible.
  float rim = exp(-d * d / 0.0025);
  float glow = exp(-max(d, 0.0) * 10.0) * step(0.0, d);
  float inside = smoothstep(0.03, -0.2, d);
  float streak = smoothstep(0.55, 0.85, tongues) * inside * smoothstep(-0.6, 0.0, d);
  float fade = smoothstep(-1.0, -0.75, p.y) * smoothstep(1.0, 0.85, max(abs(p.x), p.y));
  vec3 col = mix(uGlow, uCore, clamp(rim * 0.4 + streak * 0.5, 0.0, 1.0))
           * (rim * 0.7 + glow * 0.2 + inside * 0.025 + streak * 0.35);
  gl_FragColor = vec4(col * uIntensity * fade, 1.0);
}
`;

export const RING_FRAG = /* glsl */ `
uniform float uIntensity;
uniform float uThick;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float ring = exp(-pow((r - 0.8) / uThick, 2.0));
  gl_FragColor = vec4(uColor * ring * uIntensity * smoothstep(1.0, 0.92, r), 1.0);
}
`;

export const RIBBON_VERT = /* glsl */ `
attribute float aSide;
attribute vec3 aColor;
varying float vSide;
varying vec3 vColor;
void main() {
  vSide = aSide;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RIBBON_FRAG = /* glsl */ `
varying float vSide;
varying vec3 vColor;
void main() {
  float s2 = vSide * vSide;
  float g = exp(-s2 * 4.0);
  float core = exp(-s2 * 30.0);
  gl_FragColor = vec4(vColor * (g * 0.7 + core * 1.3), 1.0);
}
`;

export const PARTICLE_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
}
`;

export const PARTICLE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = exp(-d * d * 4.0) * smoothstep(1.0, 0.8, d);
  gl_FragColor = vec4(vColor * a * vAlpha * 1.5, 1.0);
}
`;

/** Final pass: mirrored camera feed + bloomed effects + screen shake / flash / aberration. */
export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tVideo;
uniform float uHasVideo;
uniform vec4 uVideoMap;
uniform vec2 uShake;
uniform float uFlash;
uniform float uDim;
uniform float uAberration;
uniform vec3 uTint;
uniform float uTime;
varying vec2 vUv;
${NOISE}
vec3 backdrop(vec2 uv) {
  vec3 top = vec3(0.05, 0.06, 0.12);
  vec3 bottom = vec3(0.13, 0.09, 0.07);
  vec3 col = mix(bottom, top, uv.y);
  float horizon = smoothstep(0.012, 0.0, abs(uv.y - 0.22));
  col += vec3(0.25, 0.18, 0.12) * horizon * 0.4;
  col += (fbm(uv * vec2(6.0, 3.0) + uTime * 0.02) - 0.5) * 0.04;
  return col;
}
void main() {
  vec2 uv = vUv + uShake;
  vec3 base;
  if (uHasVideo > 0.5) {
    vec2 vuv = vec2(uVideoMap.y - uv.x * uVideoMap.x, uVideoMap.w + uv.y * uVideoMap.z);
    base = texture2D(tVideo, clamp(vuv, 0.0, 1.0)).rgb;
  } else {
    base = backdrop(uv);
  }
  base *= 1.0 - uDim;
  base *= 1.0 + uTint;
  vec2 off = (uv - 0.5) * uAberration;
  vec3 fx = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
  vec3 col = base + fx;
  col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
  float vig = smoothstep(1.0, 0.35, length(vUv - 0.5));
  col *= mix(0.7, 1.0, vig);
  gl_FragColor = vec4(col, 1.0);
}
`;
