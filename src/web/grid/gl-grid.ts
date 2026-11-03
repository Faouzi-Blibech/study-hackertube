import {
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  WebGLRenderer,
} from 'three';
import { fragmentShader, vertexShader } from './shaders';

const FOV = 30;
const MAX_TILT = 0.09; // radians, about 5 degrees
const RADIUS = 12; // px, matches CSS .thumb radius

interface CardState {
  thumb: HTMLElement;
  img: HTMLImageElement;
  visible: boolean;
  mesh: Mesh | null;
  material: ShaderMaterial | null;
  texture: Texture | null;
  hover: number;
  hoverTarget: number;
  rx: number;
  ry: number;
  rxTarget: number;
  ryTarget: number;
  mouse: Vector2;
  mouseTarget: Vector2;
}

export interface GlGrid {
  setSuspended(suspended: boolean): void;
  destroy(): void;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export { webglAvailable } from '../webgl';

/**
 * One renderer for the whole grid. The DOM cards stay the layout and input source;
 * each thumbnail box gets a textured plane drawn on a fixed canvas behind the page.
 */
export function createGlGrid(root: HTMLElement, onLost: () => void): GlGrid {
  // A fresh canvas per grid: a canvas whose context was force-lost cannot be reused.
  const canvas = document.createElement('canvas');
  canvas.className = 'gl-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch (err) {
    canvas.remove();
    throw err;
  }
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 10, 5000);
  const geometry = new PlaneGeometry(1, 1, 24, 14);
  const cards: CardState[] = [];
  const byThumb = new Map<Element, CardState>();
  let width = 1;
  let height = 1;
  let raf = 0;
  let last = 0;
  let time = 0;
  let suspended = false;
  let destroyed = false;

  const resize = (): void => {
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = height / 2 / Math.tan((FOV * Math.PI) / 360);
    camera.far = camera.position.z * 4;
    camera.updateProjectionMatrix();
    request();
  };

  function request(): void {
    if (raf || suspended || destroyed || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }

  function ensureMesh(c: CardState): void {
    if (c.mesh || !c.img.complete || c.img.naturalWidth === 0) return;
    const texture = new Texture(c.img);
    texture.needsUpdate = true;
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      uniforms: {
        uTex: { value: texture },
        uMouse: { value: c.mouse },
        uSize: { value: new Vector2(1, 1) },
        uHover: { value: 0 },
        uTime: { value: 0 },
        uParallax: { value: 0 },
        uRadius: { value: RADIUS },
        uTexAspect: { value: c.img.naturalWidth / c.img.naturalHeight },
        uFade: { value: 1 },
      },
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    c.texture = texture;
    c.material = material;
    c.mesh = mesh;
    request();
  }

  function frame(now: number): void {
    raf = 0;
    if (suspended || destroyed) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    time += dt;
    const k = 1 - Math.exp(-dt * 11);
    let animating = false;
    for (const c of cards) {
      if (!c.visible) continue;
      ensureMesh(c);
      if (!c.mesh || !c.material) continue;
      c.hover = lerp(c.hover, c.hoverTarget, k);
      c.rx = lerp(c.rx, c.rxTarget, k);
      c.ry = lerp(c.ry, c.ryTarget, k);
      c.mouse.lerp(c.mouseTarget, Math.min(1, k * 1.5));
      if (Math.abs(c.hover - c.hoverTarget) < 0.002) c.hover = c.hoverTarget;
      if (c.hover > 0 || Math.abs(c.rx - c.rxTarget) > 0.0005 || Math.abs(c.ry - c.ryTarget) > 0.0005) animating = true;
      const r = c.thumb.getBoundingClientRect();
      const inView = r.bottom > -40 && r.top < height + 40 && r.right > -40 && r.left < width + 40;
      c.mesh.visible = inView;
      if (!inView) continue;
      const u = c.material.uniforms;
      (u['uSize']!.value as Vector2).set(r.width, r.height);
      u['uHover']!.value = c.hover;
      u['uTime']!.value = time;
      u['uParallax']!.value = Math.max(-1, Math.min(1, (r.top + r.height / 2 - height / 2) / (height / 2)));
      c.mesh.position.set(r.left + r.width / 2 - width / 2, -(r.top + r.height / 2 - height / 2), c.hover * 24);
      c.mesh.scale.set(r.width * (1 + 0.03 * c.hover), r.height * (1 + 0.03 * c.hover), 1);
      c.mesh.rotation.set(c.rx, c.ry, 0);
      c.thumb.dataset.gl = '1';
    }
    renderer.render(scene, camera);
    if (animating) request();
    else last = 0;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const c = byThumb.get(e.target);
        if (c) c.visible = e.isIntersecting;
      }
      request();
    },
    { rootMargin: '120px 0px' },
  );

  const thumbs = root.querySelectorAll<HTMLElement>('.thumb');
  thumbs.forEach((thumb) => {
    const img = thumb.querySelector('img');
    if (!img) return;
    const c: CardState = {
      thumb, img, visible: false, mesh: null, material: null, texture: null,
      hover: 0, hoverTarget: 0, rx: 0, ry: 0, rxTarget: 0, ryTarget: 0,
      mouse: new Vector2(0.5, 0.5), mouseTarget: new Vector2(0.5, 0.5),
    };
    cards.push(c);
    byThumb.set(thumb, c);
    io.observe(thumb);
    img.addEventListener('load', request);
    const card = thumb.closest('.card');
    const move = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return;
      const r = thumb.getBoundingClientRect();
      const mx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const my = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
      c.mouseTarget.set(mx, my);
      c.hoverTarget = 1;
      c.ryTarget = (mx - 0.5) * 2 * MAX_TILT;
      c.rxTarget = -(my - 0.5) * 2 * MAX_TILT;
      request();
    };
    const leave = (): void => {
      c.hoverTarget = 0;
      c.rxTarget = 0;
      c.ryTarget = 0;
      request();
    };
    card?.addEventListener('pointermove', move as EventListener);
    card?.addEventListener('pointerleave', leave);
    card?.addEventListener('blur', leave);
  });

  const onScroll = (): void => request();
  const onVisibility = (): void => {
    last = 0;
    request();
  };
  const onContextLost = (e: Event): void => {
    e.preventDefault();
    onLost();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onContextLost);
  const ro = new ResizeObserver(request); // late layout changes (fonts, images) move the thumbs
  ro.observe(root);
  resize();

  return {
    setSuspended(s: boolean): void {
      suspended = s;
      if (s && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (!s) {
        last = 0;
        request();
      }
    },
    destroy(): void {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      for (const c of cards) {
        c.img.removeEventListener('load', request);
        c.material?.dispose();
        c.texture?.dispose();
        delete c.thumb.dataset.gl;
      }
      geometry.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
