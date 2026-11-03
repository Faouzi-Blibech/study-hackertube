import { PerspectiveCamera, Vector3 } from 'three';

const MIN_R = 0.35;
const MAX_R = 4;

/** Small damped orbit controller: drag rotates, wheel/pinch zooms, arrows and +/- work from the keyboard. */
export class Orbit {
  theta = 0.6;
  phi = 1.25;
  radius = 3;
  readonly target = new Vector3();
  private gTheta = 0.6;
  private gPhi = 1.25;
  private gRadius = 3;
  private readonly gTarget = new Vector3();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private downAt: { x: number; y: number } | null = null;
  private moved = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly onChange: () => void,
    private readonly onTap: (x: number, y: number, pointerType: string) => void,
    private readonly onHover: (x: number, y: number) => void,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('keydown', this.key);
  }

  /** Ease toward a new framing. */
  focus(target: Vector3, radius: number): void {
    this.gTarget.copy(target);
    this.gRadius = Math.min(MAX_R, Math.max(MIN_R, radius));
    this.onChange();
  }

  /** Set the framing immediately but start further out so the first frames ease in. */
  reset(target: Vector3, radius: number, from: number): void {
    this.target.copy(target);
    this.gTarget.copy(target);
    this.radius = from;
    this.gRadius = radius;
    this.onChange();
  }

  /** Advance the damping; returns true while the view is still moving. */
  update(dt: number, camera: PerspectiveCamera): boolean {
    const k = 1 - Math.exp(-dt * 9);
    this.theta += (this.gTheta - this.theta) * k;
    this.phi += (this.gPhi - this.phi) * k;
    this.radius += (this.gRadius - this.radius) * k;
    this.target.lerp(this.gTarget, k);
    const sp = Math.sin(this.phi);
    camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta),
    );
    camera.lookAt(this.target);
    const moving =
      Math.abs(this.gTheta - this.theta) > 1e-4 ||
      Math.abs(this.gPhi - this.phi) > 1e-4 ||
      Math.abs(this.gRadius - this.radius) > 1e-4 ||
      this.target.distanceToSquared(this.gTarget) > 1e-8;
    return moving;
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.cancel);
    this.el.removeEventListener('wheel', this.wheel);
    this.el.removeEventListener('keydown', this.key);
  }

  private rotate(dx: number, dy: number): void {
    this.gTheta -= dx * 0.006;
    this.gPhi = Math.min(Math.PI - 0.15, Math.max(0.15, this.gPhi - dy * 0.006));
    this.onChange();
  }

  private zoom(factor: number): void {
    this.gRadius = Math.min(MAX_R, Math.max(MIN_R, this.gRadius * factor));
    this.onChange();
  }

  private readonly down = (e: PointerEvent): void => {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.downAt = { x: e.clientX, y: e.clientY };
      this.moved = 0;
    } else {
      this.pinch = this.pinchDistance();
      this.moved = 99;
    }
  };

  private readonly move = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') this.onHover(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.pointers.size >= 2) {
      const d = this.pinchDistance();
      if (this.pinch > 0 && d > 0) this.zoom(this.pinch / d);
      this.pinch = d;
    } else if (this.moved > 5) {
      this.rotate(dx, dy);
    }
  };

  private readonly up = (e: PointerEvent): void => {
    const was = this.pointers.delete(e.pointerId);
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    if (was && this.pointers.size === 0 && this.moved <= 5 && this.downAt) this.onTap(e.clientX, e.clientY, e.pointerType);
    this.pinch = 0;
  };

  private readonly cancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.moved = 99;
  };

  private readonly wheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoom(Math.exp(Math.max(-120, Math.min(120, e.deltaY)) * 0.0015));
  };

  private readonly key = (e: KeyboardEvent): void => {
    const step = 28;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => this.rotate(-step, 0),
      ArrowRight: () => this.rotate(step, 0),
      ArrowUp: () => this.rotate(0, -step),
      ArrowDown: () => this.rotate(0, step),
      '+': () => this.zoom(0.85),
      '=': () => this.zoom(0.85),
      '-': () => this.zoom(1 / 0.85),
    };
    const run = actions[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
