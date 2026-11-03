// Point sprites for the galaxy. aState: 0 = dimmed, 1 = normal, 2 = matched (glows in the accent color).
export const vertexShader = /* glsl */ `
attribute vec3 aColor;
attribute float aState;
uniform float uScale;    // pixels per world unit at distance 1
uniform float uSize;     // base point diameter in world units
uniform float uDist;     // camera distance to its target, for the depth cue
uniform vec3 uAlpha;     // alpha for state 0, 1, 2
varying vec3 vColor;
varying float vAlpha;
varying float vMatched;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float matched = step(1.5, aState);
  float factor = mix(mix(0.75, 1.0, step(0.5, aState)), 4.2, matched);
  gl_PointSize = clamp(uSize * factor * uScale / max(-mv.z, 0.05), 1.5, 64.0);
  float depth = clamp((-mv.z - (uDist - 1.0)) / 2.0, 0.0, 1.0);
  float a = aState < 0.5 ? uAlpha.x : (aState < 1.5 ? uAlpha.y : uAlpha.z);
  vAlpha = a * mix(1.0, 0.55, depth * (1.0 - matched));
  vColor = aColor;
  vMatched = matched;
  gl_Position = projectionMatrix * mv;
}
`;

export const fragmentShader = /* glsl */ `
uniform vec3 uAccent;
uniform float uDark;
varying vec3 vColor;
varying float vAlpha;
varying float vMatched;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float disc = smoothstep(1.0, 0.82, d);
  float core = smoothstep(0.34, 0.26, d);
  float glow = pow(1.0 - d, 2.4) * 0.6;
  float matchedA = max(core, glow);
  float alpha = mix(disc, matchedA, vMatched) * vAlpha;
  vec3 hot = mix(uAccent, vec3(1.0), 0.35 * uDark * core);
  vec3 rgb = mix(vColor, hot, vMatched);
  gl_FragColor = vec4(rgb, alpha);
}
`;
