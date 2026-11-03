// Vertex: the plane bulges gently toward the viewer around the pointer while hovered.
export const vertexShader = /* glsl */ `
uniform vec2 uMouse;
uniform vec2 uSize;
uniform float uHover;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float d = distance(uv * uSize, uMouse * uSize);
  float lift = smoothstep(max(uSize.x, uSize.y) * 0.55, 0.0, d);
  p.z += lift * uHover * 14.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

// Fragment: cover-fit texture, scroll parallax, rounded corners, and a subtle liquid
// distortion (noise warp + ripple + lens pull) centred on the pointer.
export const fragmentShader = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uMouse;
uniform vec2 uSize;
uniform float uHover;
uniform float uTime;
uniform float uParallax;
uniform float uRadius;
uniform float uTexAspect;
uniform float uFade;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 px = vUv * uSize;
  vec2 q = abs(px - uSize * 0.5) - (uSize * 0.5 - uRadius);
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float mask = 1.0 - smoothstep(-1.0, 0.5, sd);

  float pa = uSize.x / uSize.y;
  vec2 fit = pa > uTexAspect ? vec2(1.0, uTexAspect / pa) : vec2(pa / uTexAspect, 1.0);
  vec2 uv = (vUv - 0.5) * fit / 1.08 + 0.5;
  uv.y += uParallax * 0.03 * fit.y;

  vec2 diff = (vUv - uMouse) * vec2(pa, 1.0);
  float d = length(diff);
  vec2 dir = diff / max(d, 0.0001);
  float inf = smoothstep(0.75, 0.0, d) * uHover;
  float n = noise(vUv * vec2(pa, 1.0) * 5.0 + uTime * 0.35);
  vec2 warp = (n - 0.5) * 0.035 * vec2(1.0, 1.0) * inf;
  warp += dir * sin(d * 22.0 - uTime * 2.5) * 0.005 * inf;
  warp -= (vUv - uMouse) * 0.05 * inf;
  warp *= fit;
  vec2 split = dir * 0.0025 * inf * fit;

  float r = texture2D(uTex, uv + warp + split).r;
  float g = texture2D(uTex, uv + warp).g;
  float b = texture2D(uTex, uv + warp - split).b;
  float a = mask * uFade;
  gl_FragColor = vec4(vec3(r, g, b), a);
}
`;
