// Loading the static data files the site ships in public/data/.
import type { Segment, Video } from './types';
import { decodeF16 } from './f16';

export interface VideoIndex {
  videos: Video[];
  /** Row-major [videos.length, dims], L2-normalized; row i belongs to videos[i]. */
  embeddings: Float32Array;
  dims: number;
}

export interface VideoSegments {
  segments: Segment[];
  /** Row-major [segments.length, dims], aligned with segments. */
  embeddings: Float32Array;
}

interface SegmentFile {
  vid: string;
  segments: { start: number; end: number; snippet: string }[];
}

function dataUrl(path: string): string {
  const base = import.meta.env?.BASE_URL ?? '/';
  return `${base}data/${path}`;
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

let videoIndexPromise: Promise<VideoIndex> | null = null;

/** Load videos.json and video_emb.f16 once (cached for the page lifetime). */
export function loadVideoIndex(): Promise<VideoIndex> {
  if (!videoIndexPromise) {
    videoIndexPromise = (async () => {
      const [videosRes, embRes, manifestRes] = await Promise.all([
        fetchOk(dataUrl('videos.json')),
        fetchOk(dataUrl('video_emb.f16')),
        fetchOk(dataUrl('manifest.json')),
      ]);
      const videos = (await videosRes.json()) as Video[];
      const manifest = (await manifestRes.json()) as { dims: number };
      const embeddings = decodeF16(await embRes.arrayBuffer());
      if (embeddings.length !== videos.length * manifest.dims) {
        throw new Error(`embedding size ${embeddings.length} does not match ${videos.length} videos x ${manifest.dims}`);
      }
      return { videos, embeddings, dims: manifest.dims };
    })().catch((err: unknown) => {
      videoIndexPromise = null;
      throw err;
    });
  }
  return videoIndexPromise;
}

let segmentVidsPromise: Promise<Set<string> | null> | null = null;

/** The set of vids that have segment files, or null when index.json is missing. */
function loadSegmentVids(): Promise<Set<string> | null> {
  if (!segmentVidsPromise) {
    segmentVidsPromise = (async () => {
      try {
        const res = await fetchOk(dataUrl('segments/index.json'));
        return new Set((await res.json()) as string[]);
      } catch {
        return null;
      }
    })();
  }
  return segmentVidsPromise;
}

const segmentCache = new Map<string, Promise<VideoSegments | null>>();

/** Load segments for one video; null when the video has none (or they fail to load). */
export function loadSegments(vid: string): Promise<VideoSegments | null> {
  let p = segmentCache.get(vid);
  if (!p) {
    p = (async () => {
      const known = await loadSegmentVids();
      if (known && !known.has(vid)) return null;
      try {
        const [metaRes, embRes] = await Promise.all([
          fetchOk(dataUrl(`segments/${vid}.json`)),
          fetchOk(dataUrl(`segments/${vid}.f16`)),
        ]);
        const meta = (await metaRes.json()) as SegmentFile;
        const embeddings = decodeF16(await embRes.arrayBuffer());
        const segments: Segment[] = meta.segments.map((s) => ({ start: s.start, end: s.end, text: s.snippet }));
        if (segments.length === 0 || embeddings.length % segments.length !== 0) return null;
        return { segments, embeddings };
      } catch {
        return null; // dev servers answer unknown paths with index.html: treat parse errors as "none"
      }
    })();
    segmentCache.set(vid, p);
  }
  return p;
}

export interface Taxonomy {
  areas: { id: string; name: string; categories: { id: string; name: string; description: string }[] }[];
}

let taxonomyPromise: Promise<Taxonomy> | null = null;

/** Load taxonomy.json once (16 areas, 150 categories). */
export function loadTaxonomy(): Promise<Taxonomy> {
  if (!taxonomyPromise) {
    taxonomyPromise = fetchOk(dataUrl('taxonomy.json'))
      .then((res) => res.json() as Promise<Taxonomy>)
      .catch((err: unknown) => {
        taxonomyPromise = null;
        throw err;
      });
  }
  return taxonomyPromise;
}
