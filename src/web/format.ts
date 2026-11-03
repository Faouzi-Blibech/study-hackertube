import type { Match } from '../core/types';
import { COVERAGE_THRESHOLD } from '../core/coverage';

/** Format seconds as m:ss or h:mm:ss. */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const thumbUrl = (vid: string): string => `https://i.ytimg.com/vi/${vid}/hq2.jpg`;
export const thumbFallbackUrl = (vid: string): string => `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

export const youtubeUrl = (vid: string, start: number): string =>
  `https://www.youtube.com/watch?v=${vid}&t=${Math.floor(start)}s`;
export const hackerTubeUrl = (vid: string): string => `https://hackertube.org/watch/${vid}`;
export const embedUrl = (vid: string, start: number): string =>
  `https://www.youtube-nocookie.com/embed/${vid}?start=${Math.floor(start)}&autoplay=1&rel=0`;

/** True when the video is related to the course part but not a close match. */
export const isLoose = (m: Match): boolean => m.similarity !== undefined && m.similarity < COVERAGE_THRESHOLD;
