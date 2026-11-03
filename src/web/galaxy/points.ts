import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { fragmentShader, vertexShader } from './shaders';

export const BASE_SIZE = 0.011; // point diameter in world units

export type PointState = 0 | 1 | 2; // dimmed, normal, matched

/** The one THREE.Points holding every video; slots are sorted by state so lit points draw last. */
export class PointCloud {
  readonly object: Points;
  /** slot -> row in videos.json, in draw order. */
  readonly rows: Int32Array;
  readonly states: Uint8Array;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly xyz: Float32Array;
  private readonly tmp = new Vector3();

  constructor(
    layout: { i: number; x: number; y: number; z: number }[],
    stateOf: (row: number) => PointState,
    colorOf: (row: number) => Color,
    alpha: [number, number, number],
  ) {
    const order = layout.map((p) => ({ p, s: stateOf(p.i) })).sort((a, b) => a.s - b.s);
    const n = order.length;
    this.rows = new Int32Array(n);
    this.states = new Uint8Array(n);
    this.xyz = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const st = new Float32Array(n);
    order.forEach(({ p, s }, k) => {
      this.rows[k] = p.i;
      this.states[k] = s;
      st[k] = s;
      this.xyz.set([p.x, p.y, p.z], k * 3);
      const c = colorOf(p.i);
      col.set([c.r, c.g, c.b], k * 3);
    });
    this.geometry.setAttribute('position', new BufferAttribute(this.xyz, 3));
    this.geometry.setAttribute('aColor', new BufferAttribute(col, 3));
    this.geometry.setAttribute('aState', new BufferAttribute(st, 1));
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uScale: { value: 800 },
        uSize: { value: BASE_SIZE },
        uDist: { value: 3 },
        uAlpha: { value: new Vector3(...alpha) },
        uAccent: { value: new Color('#c93a27') },
        uDark: { value: 0 },
      },
    });
    this.object = new Points(this.geometry, this.material);
    this.object.frustumCulled = false;
  }

  setView(scalePx: number, dist: number, accent: Color, dark: boolean): void {
    const u = this.material.uniforms;
    u['uScale']!.value = scalePx;
    u['uDist']!.value = dist;
    (u['uAccent']!.value as Color).copy(accent);
    u['uDark']!.value = dark ? 1 : 0;
  }

  /** Recolor in place (used when the color scheme changes). */
  recolor(colorOf: (row: number) => Color): void {
    const attr = this.geometry.getAttribute('aColor') as BufferAttribute;
    for (let k = 0; k < this.rows.length; k++) {
      const c = colorOf(this.rows[k]!);
      attr.setXYZ(k, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
  }

  position(slot: number, out: Vector3): Vector3 {
    return out.set(this.xyz[slot * 3]!, this.xyz[slot * 3 + 1]!, this.xyz[slot * 3 + 2]!);
  }

  /** Nearest slot to a screen position within `reachPx`, preferring matched points; -1 if none. */
  pick(camera: PerspectiveCamera, w: number, h: number, x: number, y: number, reachPx: number): number {
    let best = -1;
    let bestScore = Infinity;
    for (let k = 0; k < this.rows.length; k++) {
      this.position(k, this.tmp).project(camera);
      if (this.tmp.z > 1) continue;
      const dx = (this.tmp.x * 0.5 + 0.5) * w - x;
      const dy = (-this.tmp.y * 0.5 + 0.5) * h - y;
      const lit = this.states[k] === 2;
      const d = Math.hypot(dx, dy) * (lit ? 0.5 : 1);
      if (d <= reachPx && d < bestScore) {
        best = k;
        bestScore = d;
      }
    }
    return best;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
