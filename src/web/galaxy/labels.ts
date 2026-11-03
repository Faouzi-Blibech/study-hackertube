import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';

interface Label {
  el: HTMLElement;
  pos: Vector3;
  kind: 'area' | 'cat';
  pinned: boolean; // part of the identified course: always visible
}

const ZOOM_IN = 1.3; // category labels start to appear below this camera distance
const ZOOM_FULL = 0.85;

/** HTML labels pinned to 3D points: area names always, category names when zoomed in or part of the course. */
export class Labels {
  private readonly items: Label[] = [];
  private readonly v = new Vector3();

  constructor(private readonly host: HTMLElement) {}

  add(text: string, x: number, y: number, z: number, kind: 'area' | 'cat', pinned = false, color?: string): void {
    const el = document.createElement('span');
    el.className = `galaxy-label galaxy-label-${kind}`;
    if (pinned) el.classList.add('is-course');
    el.textContent = text;
    if (color) el.style.setProperty('--dot', color);
    this.host.append(el);
    this.items.push({ el, pos: new Vector3(x, y, z), kind, pinned });
  }

  clear(): void {
    for (const it of this.items) it.el.remove();
    this.items.length = 0;
  }

  update(camera: PerspectiveCamera, w: number, h: number, radius: number, target: Vector3): void {
    const zoomT = Math.min(1, Math.max(0, (ZOOM_IN - radius) / (ZOOM_IN - ZOOM_FULL)));
    const reach = 0.5 * Math.min(w, h);
    const toTarget = camera.position.distanceTo(target);
    for (const it of this.items) {
      this.v.copy(it.pos).project(camera);
      const sx = (this.v.x * 0.5 + 0.5) * w;
      const sy = (-this.v.y * 0.5 + 0.5) * h;
      const inFront = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      // Points on the far side of the target are fainter; the near side reads clearly.
      const depth = Math.min(1, Math.max(0, (camera.position.distanceTo(it.pos) - (toTarget - 1)) / 2));
      let a = 1 - 0.65 * depth;
      if (it.kind === 'cat' && !it.pinned) {
        const centered = 1 - Math.min(1, Math.hypot(sx - w / 2, sy - h / 2) / (reach * 1.15));
        a = a * zoomT * centered;
      } else if (it.kind === 'area') {
        a *= 1 - 0.7 * zoomT;
      }
      const show = inFront && a > 0.04;
      it.el.style.opacity = show ? a.toFixed(2) : '0';
      it.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
    }
  }
}
