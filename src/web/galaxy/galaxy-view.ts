import { PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Color } from 'three';
import type { CourseIdentity, Match, Video } from '../../core/types';
import { formatTime } from '../format';
import { openPlayer } from '../player';
import { Orbit } from './controls';
import { loadGalaxy } from './data';
import { frameFor } from './framing';
import { Labels } from './labels';
import { areaColors, cssColor } from './palette';
import { PointCloud, type PointState } from './points';

const FOV = 45;
const dpr = (): number => Math.min(window.devicePixelRatio || 1, 2);

export interface GalaxyOptions {
  /** Matches to light up; null shows the whole catalog evenly (home page). */
  matches: Match[] | null;
  course?: CourseIdentity | undefined;
  onLost(): void;
}

export interface GalaxyView {
  setSuspended(suspended: boolean): void;
  destroy(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  n.className = cls;
  return n;
};

/** Build the galaxy inside `host` (a positioned, sized box). Resolves once data is loaded and the first frame is queued. */
export async function createGalaxy(host: HTMLElement, opts: GalaxyOptions): Promise<GalaxyView> {
  const { galaxy, videos, areaNames } = await loadGalaxy();
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const byVid = new Map(opts.matches?.map((m) => [m.video.vid, m]));
  const course = opts.course;
  const courseCats = new Set(course?.categories.map((c) => c.id));

  const canvas = el('canvas', 'galaxy-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'group');
  canvas.setAttribute(
    'aria-label',
    'Topic galaxy, a 3D map of the catalog. Drag or use the arrow keys to rotate, scroll or plus and minus to zoom. Switch to Grid view for a list.',
  );
  const labelHost = el('div', 'galaxy-labels');
  labelHost.setAttribute('aria-hidden', 'true');
  const tip = el('div', 'galaxy-tip');
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  const ring = el('div', 'galaxy-ring');
  ring.hidden = true;
  host.append(canvas, labelHost, ring, tip);

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch (err) {
    host.replaceChildren();
    throw err;
  }
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.05, 20);

  // Layout facts: area/category positions and colors.
  const catPos = new Map(galaxy.categories.map((c) => [c.id, new Vector3(c.x, c.y, c.z)]));
  const areaIds = [...new Set(galaxy.categories.map((c) => c.area))];
  const areaCenter = new Map<string, Vector3>();
  for (const a of areaIds) {
    const cs = galaxy.categories.filter((c) => c.area === a);
    areaCenter.set(a, cs.reduce((s, c) => s.add(catPos.get(c.id)!), new Vector3()).divideScalar(cs.length));
  }
  const flat = new Map([...areaCenter].map(([a, v]) => [a, [v.x, v.z] as [number, number]]));
  let colors: Map<string, Color> = areaColors(areaIds, flat, darkQuery.matches);
  const colorOf = (row: number): Color => colors.get(videos[row]?.area ?? '') ?? colors.values().next().value!;
  const stateOf = (row: number): PointState => {
    const v = videos[row] as Video;
    if (!opts.matches) return 1;
    if (byVid.has(v.vid)) return 2;
    return course && v.area === course.area.id ? 1 : 0;
  };
  const cloud = new PointCloud(galaxy.videos, stateOf, colorOf, opts.matches ? [0.15, 0.6, 1] : [0.1, 0.8, 1]);
  scene.add(cloud.object);

  const labels = new Labels(labelHost);
  const swatch = (id: string): string => `#${colors.get(id)?.getHexString() ?? '888888'}`;
  for (const a of areaIds) {
    const c = areaCenter.get(a)!;
    labels.add(areaNames.get(a) ?? a, c.x, c.y, c.z, 'area', a === course?.area.id, swatch(a));
  }
  for (const c of galaxy.categories) labels.add(c.name, c.x, c.y, c.z, 'cat', courseCats.has(c.id));

  let w = 1;
  let h = 1;
  let raf = 0;
  let last = 0;
  let suspended = false;
  let destroyed = false;
  let visible = true;
  let hover = -1;

  const orbit = new Orbit(canvas, request, onTap, onHover);
  const focus = frameFor(opts.course, opts.matches, galaxy.videos, videos, catPos, areaCenter);
  orbit.reset(focus.target, focus.radius, focus.radius + 1.4);

  function request(): void {
    if (raf || suspended || destroyed || document.hidden || !visible) return;
    if (!last) last = performance.now() - 16;
    raf = requestAnimationFrame(frame);
  }

  function frame(now: number): void {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const moving = orbit.update(dt, camera);
    const scale = (h * dpr()) / (2 * Math.tan((FOV * Math.PI) / 360));
    cloud.setView(scale, orbit.radius, cssColor('--accent', '#c93a27'), darkQuery.matches);
    renderer.render(scene, camera);
    labels.update(camera, w, h, orbit.radius, orbit.target);
    placeRing();
    if (moving) request();
    else last = 0; // idle: stop rendering until something asks again
  }

  function resize(): void {
    w = Math.max(1, host.clientWidth);
    h = Math.max(1, host.clientHeight);
    renderer.setPixelRatio(dpr());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    request();
  }

  function local(cx: number, cy: number): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  }

  const matchFor = (slot: number): Match => {
    const video = videos[cloud.rows[slot]!] as Video;
    return byVid.get(video.vid) ?? { video, score: 1, startSeconds: 0, segment: null, chunkIds: [] };
  };

  function placeRing(): void {
    if (hover < 0) {
      ring.hidden = true;
      return;
    }
    const p = cloud.position(hover, new Vector3()).project(camera);
    ring.hidden = false;
    ring.style.transform = `translate(${((p.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -50%)`;
  }

  function onHover(cx: number, cy: number): void {
    const { x, y } = local(cx, cy);
    const slot = cloud.pick(camera, w, h, x, y, 9);
    if (slot !== hover) {
      hover = slot;
      canvas.style.cursor = slot >= 0 ? 'pointer' : 'grab';
    }
    if (slot < 0) {
      tip.hidden = true;
      placeRing();
      return;
    }
    const m = matchFor(slot);
    tip.replaceChildren();
    const title = el('strong', 'galaxy-tip-title');
    title.textContent = m.video.title;
    const sub = el('span', 'galaxy-tip-sub');
    sub.textContent = [m.video.channel, m.startSeconds > 0 ? `from ${formatTime(m.startSeconds)}` : ''].filter(Boolean).join(' - ');
    tip.append(title, sub);
    tip.hidden = false;
    const tx = Math.min(Math.max(8, x + 14), w - tip.offsetWidth - 8);
    const ty = Math.min(Math.max(8, y + 16), h - tip.offsetHeight - 8);
    tip.style.transform = `translate(${tx.toFixed(0)}px, ${ty.toFixed(0)}px)`;
    placeRing();
  }

  function onTap(cx: number, cy: number, pointerType: string): void {
    const { x, y } = local(cx, cy);
    const slot = cloud.pick(camera, w, h, x, y, pointerType === 'mouse' ? 10 : 22);
    if (slot < 0) return;
    tip.hidden = true;
    openPlayer(matchFor(slot), canvas, { onOpen: () => view.setSuspended(true), onClose: () => view.setSuspended(false) });
  }

  const onScheme = (): void => {
    colors = areaColors(areaIds, flat, darkQuery.matches);
    cloud.recolor(colorOf);
    request();
  };
  const onVisibility = (): void => request();
  const onContextLost = (e: Event): void => {
    e.preventDefault();
    opts.onLost();
  };
  const onLeave = (): void => {
    hover = -1;
    tip.hidden = true;
    ring.hidden = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    request();
  });
  io.observe(host);
  darkQuery.addEventListener('change', onScheme);
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('pointerleave', onLeave);
  resize();

  const view: GalaxyView = {
    setSuspended(s) {
      suspended = s;
      if (!s) request();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      orbit.dispose();
      darkQuery.removeEventListener('change', onScheme);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('pointerleave', onLeave);
      labels.clear();
      scene.remove(cloud.object);
      cloud.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      host.replaceChildren();
    },
  };
  return view;
}
