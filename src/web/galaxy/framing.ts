import { Vector3 } from 'three';
import type { CourseIdentity, Match, Video } from '../../core/types';

/** Where the camera should look: the identified course, else the matches, else the whole catalog. */
export function frameFor(
  course: CourseIdentity | undefined,
  matches: Match[] | null,
  layout: { i: number; x: number; y: number; z: number }[],
  videos: Video[],
  catPos: Map<string, Vector3>,
  areaCenter: Map<string, Vector3>,
): { target: Vector3; radius: number } {
  const pts: Vector3[] = [];
  if (course) {
    for (const c of course.categories) {
      const p = catPos.get(c.id);
      if (p) pts.push(p);
    }
    const a = areaCenter.get(course.area.id);
    if (pts.length === 0 && a) pts.push(a);
  } else if (matches) {
    const vids = new Set(matches.map((m) => m.video.vid));
    for (const g of layout) if (vids.has(videos[g.i]?.vid ?? '')) pts.push(new Vector3(g.x, g.y, g.z));
  }
  if (pts.length === 0) return { target: new Vector3(), radius: 2.4 };
  const target = pts.reduce((s, p) => s.add(p), new Vector3()).divideScalar(pts.length);
  const spread = Math.sqrt(pts.reduce((s, p) => s + p.distanceToSquared(target), 0) / pts.length);
  return { target, radius: Math.min(2.4, Math.max(1.5, 1.4 + spread * 2.2)) };
}
