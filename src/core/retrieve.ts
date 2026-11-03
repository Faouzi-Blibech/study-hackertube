// Two-step retrieval. Everything here is pure (arrays in, arrays out) except retrieve(),
// which takes a segment loader so tests and the UI can plug in their own.
//
// Step A (video level): for every chunk, dot product against every video row (all rows are
//   L2-normalized, so dot == cosine), keep the top K videos per chunk. A video's aggregate is
//     aggregate(v) = (sum over chunks c that have v in their top K of sim(c, v)) * (1 + BOOST * score(v) / maxScore)
//   Summing rewards videos that explain many chunks of the document; the K cutoff keeps weak
//   matches out. The boost is small (at most +10%) so HackerTube's own quality score only
//   breaks near-ties. The top N videos by aggregate become candidates.
// Step B (segment level): for each candidate, take the best segment against the chunks that
//   hit it (max dot product); startSeconds = that segment's start.
// Final score = aggregate / best aggregate, so the top match is 1 and the rest are relative.
import type { Coverage, Match, PdfChunk, SectionMatches, Segment, Video } from './types';
import type { VideoSegments } from './data';
import { assessCoverage } from './coverage';
import { shortTitle } from './text';

export interface RetrieveOptions {
  topKPerChunk?: number; // default 40
  topVideos?: number; // default 40
  scoreBoost?: number; // default 0.1
}

export interface ChunkHit {
  videoIdx: number;
  sim: number;
}

export interface Candidate {
  videoIdx: number;
  aggregate: number;
  /** Chunk indices (into the chunk embedding matrix) that hit this video, best first. */
  chunkIdxs: number[];
  /** Best single chunk similarity for this video (absolute cosine). */
  maxSim: number;
}

export interface RetrieveResult {
  matches: Match[];
  coverage: Coverage;
  sections: SectionMatches[];
}

function dot(a: Float32Array, aOff: number, b: Float32Array, bOff: number, dims: number): number {
  let s = 0;
  for (let i = 0; i < dims; i++) s += a[aOff + i]! * b[bOff + i]!;
  return s;
}

/** Step A, part 1: top-K videos for every chunk. chunkEmb is [nChunks, dims] row-major. */
export function topVideosPerChunk(
  chunkEmb: Float32Array,
  videoEmb: Float32Array,
  dims: number,
  topK = 20,
): ChunkHit[][] {
  const nChunks = chunkEmb.length / dims;
  const nVideos = videoEmb.length / dims;
  const result: ChunkHit[][] = [];
  const sims = new Float32Array(nVideos);
  const order = new Uint32Array(nVideos);
  for (let c = 0; c < nChunks; c++) {
    for (let v = 0; v < nVideos; v++) {
      sims[v] = dot(chunkEmb, c * dims, videoEmb, v * dims, dims);
      order[v] = v;
    }
    const sorted = Array.from(order).sort((x, y) => sims[y]! - sims[x]!);
    result.push(sorted.slice(0, topK).map((videoIdx) => ({ videoIdx, sim: sims[videoIdx]! })));
  }
  return result;
}

/** Step A, part 2: combine per-chunk hits into ranked candidate videos (formula in header). */
export function aggregateCandidates(
  hitsPerChunk: ChunkHit[][],
  videos: Pick<Video, 'score'>[],
  opts: RetrieveOptions = {},
): Candidate[] {
  const topN = opts.topVideos ?? 40;
  const boost = opts.scoreBoost ?? 0.1;
  const maxScore = Math.max(1e-9, ...videos.map((v) => v.score));
  const acc = new Map<number, { sum: number; hits: { chunk: number; sim: number }[] }>();
  hitsPerChunk.forEach((hits, chunk) => {
    for (const h of hits) {
      const entry = acc.get(h.videoIdx) ?? { sum: 0, hits: [] };
      entry.sum += h.sim;
      entry.hits.push({ chunk, sim: h.sim });
      acc.set(h.videoIdx, entry);
    }
  });
  const candidates: Candidate[] = [];
  for (const [videoIdx, e] of acc) {
    const aggregate = e.sum * (1 + (boost * (videos[videoIdx]?.score ?? 0)) / maxScore);
    e.hits.sort((a, b) => b.sim - a.sim);
    candidates.push({ videoIdx, aggregate, chunkIdxs: e.hits.map((h) => h.chunk), maxSim: e.hits[0]?.sim ?? 0 });
  }
  candidates.sort((a, b) => b.aggregate - a.aggregate);
  return candidates.slice(0, topN);
}

export interface ChunkGroup {
  title: string;
  indices: number[];
}

/** Keep heading runs in document order; unheaded chunks continue the preceding run. */
export function groupChunks(chunks: PdfChunk[], cap = 12): ChunkGroup[] {
  const groups: ChunkGroup[] = [];
  let previousHeading: string | null = null;
  chunks.forEach((chunk, index) => {
    const heading = chunk.heading?.trim() || null;
    const previous = groups.at(-1);
    if (!previous || (heading && heading !== previousHeading)) {
      groups.push({ title: heading ?? 'Introduction', indices: [index] });
    } else {
      previous.indices.push(index);
    }
    if (heading) previousHeading = heading;
  });
  while (groups.length > cap) {
    let smallest = 0;
    for (let i = 1; i < groups.length; i++) {
      if (groups[i]!.indices.length < groups[smallest]!.indices.length) smallest = i;
    }
    const left = smallest === 0 ? 0 : smallest === groups.length - 1 ? smallest - 1
      : groups[smallest - 1]!.indices.length <= groups[smallest + 1]!.indices.length ? smallest - 1 : smallest;
    const first = groups[left]!;
    const second = groups[left + 1]!;
    groups.splice(left, 2, {
      title: first.title, // merged groups keep the first heading; long joined titles are unreadable
      indices: [...first.indices, ...second.indices],
    });
  }
  return groups;
}

/** Step B for one video: best segment against the given chunk rows; null when no segments. */
export function bestSegment(
  segs: VideoSegments | null,
  chunkEmb: Float32Array,
  chunkIdxs: number[],
  dims: number,
): { segment: Segment; sim: number } | null {
  if (!segs || segs.segments.length === 0) return null;
  let best: { idx: number; sim: number } | null = null;
  for (let s = 0; s < segs.segments.length; s++) {
    for (const c of chunkIdxs) {
      const sim = dot(chunkEmb, c * dims, segs.embeddings, s * dims, dims);
      if (!best || sim > best.sim) best = { idx: s, sim };
    }
  }
  return best ? { segment: segs.segments[best.idx]!, sim: best.sim } : null;
}

/** Full retrieval. chunkEmb rows align with chunks. loadSegments may return null per video. */
export async function retrieve(
  chunks: PdfChunk[],
  chunkEmb: Float32Array,
  videos: Video[],
  videoEmb: Float32Array,
  dims: number,
  loadSegments: (vid: string) => Promise<VideoSegments | null>,
  opts: RetrieveOptions = {},
): Promise<RetrieveResult> {
  if (chunks.length === 0) return { matches: [], coverage: assessCoverage([], []), sections: [] };
  const hits = topVideosPerChunk(chunkEmb, videoEmb, dims, opts.topKPerChunk ?? 40);
  const candidates = aggregateCandidates(hits, videos, opts);
  const best = candidates[0]?.aggregate ?? 1;
  const coverage = assessCoverage(chunks, hits);
  const segmentCache = new Map<string, Promise<VideoSegments | null>>();
  const cachedSegments = (vid: string): Promise<VideoSegments | null> => {
    let pending = segmentCache.get(vid);
    if (!pending) {
      pending = loadSegments(vid);
      segmentCache.set(vid, pending);
    }
    return pending;
  };
  const toMatches = (ranked: Candidate[], normalizer: number): Promise<Match[]> => Promise.all(
    ranked.map(async (cand): Promise<Match> => {
      const video = videos[cand.videoIdx]!;
      const found = bestSegment(await cachedSegments(video.vid), chunkEmb, cand.chunkIdxs, dims);
      return {
        video,
        score: Math.min(1, Math.max(0, cand.aggregate / normalizer)),
        startSeconds: found ? found.segment.start : 0,
        segment: found ? found.segment : null,
        chunkIds: cand.chunkIdxs.map((i) => chunks[i]!.id),
        similarity: cand.maxSim,
      };
    }),
  );
  const groups = groupChunks(chunks);
  const [matches, sections] = await Promise.all([
    toMatches(candidates, best),
    Promise.all(groups.map(async (group): Promise<SectionMatches> => {
      const selected = new Set(group.indices);
      const groupHits = hits.map((row, index) => selected.has(index) ? row : []);
      const ranked = aggregateCandidates(groupHits, videos, { ...opts, topVideos: 5, scoreBoost: 0 });
      return { title: shortTitle(group.title), matches: await toMatches(ranked, ranked[0]?.aggregate ?? 1) };
    })),
  ]);
  return { matches, coverage, sections };
}

