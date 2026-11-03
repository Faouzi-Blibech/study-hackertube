import { describe, expect, it } from 'vitest';
import { aggregateCandidates, bestSegment, groupChunks, retrieve, topVideosPerChunk } from './retrieve';
import type { VideoSegments } from './data';
import type { PdfChunk, Video } from './types';

const DIMS = 3;
const f = (...rows: number[][]): Float32Array => new Float32Array(rows.flat());
const unit = (x: number, y: number, z: number): number[] => {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
};
const video = (vid: string, score = 10): Video => ({
  vid, title: vid, channel: 'c', summary: '', content_type: 'lecture', level: 'intro',
  primary_topic: '', tags: [], score, categories: [], area: null,
});
const chunk = (id: number): PdfChunk => ({ id, page: 1, heading: null, text: `chunk ${id}` });

// Videos: A along x, B along y, C along z, D between x and y.
const videos = [video('A'), video('B'), video('C'), video('D')];
const videoEmb = f(unit(1, 0, 0), unit(0, 1, 0), unit(0, 0, 1), unit(1, 1, 0));

describe('Step A', () => {
  it('ranks the closest video first for each chunk and honours topK', () => {
    const hits = topVideosPerChunk(f(unit(1, 0.1, 0), unit(0, 1, 0.1)), videoEmb, DIMS, 2);
    expect(hits.map((h) => h.map((x) => x.videoIdx))).toEqual([[0, 3], [1, 3]]);
  });

  it('aggregates across chunks: a video matching several chunks beats one single strong match', () => {
    // chunks 0 and 1 lean toward D's direction, chunk 2 is exactly C.
    const chunkEmb = f(unit(1, 1.2, 0), unit(1.2, 1, 0), unit(0, 0, 1));
    const hits = topVideosPerChunk(chunkEmb, videoEmb, DIMS, 1);
    const cands = aggregateCandidates(hits, videos, { topVideos: 3 });
    expect(cands[0]!.videoIdx).toBe(3); // D: two hits
    expect(cands[0]!.chunkIdxs.sort()).toEqual([0, 1]);
    expect(cands.map((c) => c.videoIdx)).toContain(2);
  });

  it('score boost only breaks near-ties', () => {
    const vs = [video('lo', 1), video('hi', 100)];
    const hits = [[{ videoIdx: 0, sim: 0.8 }, { videoIdx: 1, sim: 0.79 }]];
    expect(aggregateCandidates(hits, vs)[0]!.videoIdx).toBe(1);
    const far = [[{ videoIdx: 0, sim: 0.9 }, { videoIdx: 1, sim: 0.5 }]];
    expect(aggregateCandidates(far, vs)[0]!.videoIdx).toBe(0);
  });
});

describe('Step B', () => {
  const segs: VideoSegments = {
    segments: [
      { start: 0, end: 30, text: 'intro' },
      { start: 30, end: 60, text: 'middle' },
      { start: 60, end: 90, text: 'end' },
    ],
    embeddings: f(unit(1, 0, 0), unit(0, 1, 0), unit(0, 0, 1)),
  };

  it('picks the segment closest to the hitting chunks', () => {
    const r = bestSegment(segs, f(unit(0, 1, 0.1)), [0], DIMS);
    expect(r?.segment.start).toBe(30);
  });

  it('considers only the chunks that hit the video', () => {
    const chunkEmb = f(unit(1, 0, 0), unit(0, 0, 1));
    expect(bestSegment(segs, chunkEmb, [1], DIMS)?.segment.start).toBe(60);
  });

  it('returns null without segments', () => {
    expect(bestSegment(null, f(unit(1, 0, 0)), [0], DIMS)).toBeNull();
  });
});

describe('retrieve', () => {
  it('returns scaled matches, uses segment start, and falls back to 0 when a video has no segments', async () => {
    const chunks = [chunk(10), chunk(11)];
    const chunkEmb = f(unit(1, 0.05, 0), unit(0.05, 1, 0));
    const segs: VideoSegments = {
      segments: [{ start: 5, end: 10, text: 'a' }, { start: 99, end: 120, text: 'b' }],
      embeddings: f(unit(0, 0, 1), unit(1, 0, 0)),
    };
    const { matches } = await retrieve(chunks, chunkEmb, videos, videoEmb, DIMS, async (vid) => (vid === 'A' ? segs : null), {
      topKPerChunk: 2,
      topVideos: 3,
    });
    const byVid = Object.fromEntries(matches.map((m) => [m.video.vid, m]));
    expect(matches[0]!.score).toBe(1);
    for (const m of matches) {
      expect(m.score).toBeGreaterThan(0);
      expect(m.score).toBeLessThanOrEqual(1);
    }
    expect(matches.map((m) => m.score)).toEqual([...matches.map((m) => m.score)].sort((a, b) => b - a));
    expect(byVid['A']!.startSeconds).toBe(99);
    expect(byVid['A']!.segment?.text).toBe('b');
    expect(byVid['A']!.chunkIds).toEqual([10]);
    expect(byVid['B']!.startSeconds).toBe(0);
    expect(byVid['B']!.segment).toBeNull();
  });

  it('returns nothing for an empty document', async () => {
    expect((await retrieve([], new Float32Array(0), videos, videoEmb, DIMS, async () => null)).matches).toEqual([]);
  });
});

describe('chapter grouping', () => {
  it.each([
    { headings: ['A', 'A', 'B', 'B', 'A'], titles: ['A', 'B', 'A'], indices: [[0, 1], [2, 3], [4]] },
    { headings: [null, null, 'A', null, 'B', null], titles: ['Introduction', 'A', 'B'], indices: [[0, 1], [2, 3], [4, 5]] },
    { headings: ['A', null, 'A', 'B'], titles: ['A', 'B'], indices: [[0, 1, 2], [3]] },
    { headings: [null, 'Introduction'], titles: ['Introduction', 'Introduction'], indices: [[0], [1]] },
  ])('groups consecutive headings and attaches null headings: $headings', ({ headings, titles, indices }) => {
    const groups = groupChunks(headings.map((heading, id) => ({ ...chunk(id), heading })));
    expect(groups.map((group) => group.title)).toEqual(titles);
    expect(groups.map((group) => group.indices)).toEqual(indices);
  });

  it('merges the smallest neighbouring groups until the cap', () => {
    const headings = Array.from({ length: 14 }, (_, i) => `Chapter ${i}`);
    const groups = groupChunks(headings.map((heading, id) => ({ ...chunk(id), heading })));
    expect(groups).toHaveLength(12);
    expect(groups.flatMap((group) => group.indices)).toEqual(headings.map((_, i) => i));
    expect(groups.some((group) => group.indices.length > 1)).toBe(true);
  });

  it('returns at most five ranked matches per group with group-specific segment starts', async () => {
    const many = Array.from({ length: 8 }, (_, i) => video(`V${i}`));
    const embeddings = f(...many.map((_, i) => unit(8 - i, i, 0)));
    const chunks = [{ ...chunk(0), heading: 'First' }, { ...chunk(1), heading: 'Second' }];
    const rows = f(unit(1, 0, 0), unit(0, 1, 0));
    const segs: VideoSegments = {
      segments: [{ start: 10, end: 20, text: 'first' }, { start: 50, end: 60, text: 'second' }],
      embeddings: rows,
    };
    const result = await retrieve(chunks, rows, many, embeddings, DIMS, async () => segs,
      { topKPerChunk: 8, topVideos: 8, scoreBoost: 0 });
    expect(result.sections).toHaveLength(2);
    for (const section of result.sections) {
      expect(section.matches).toHaveLength(5);
      expect(section.matches.map((m) => m.score)).toEqual([...section.matches.map((m) => m.score)].sort((a, b) => b - a));
    }
    expect(result.sections[0]!.matches[0]!.video.vid).toBe('V0');
    expect(result.sections[0]!.matches[0]!.startSeconds).toBe(10);
    expect(result.sections[1]!.matches[0]!.video.vid).toBe('V7');
    expect(result.sections[1]!.matches[0]!.startSeconds).toBe(50);
  });
});
