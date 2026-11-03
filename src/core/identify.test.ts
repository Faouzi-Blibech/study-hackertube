import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Taxonomy } from './data';
import { decodeF16 } from './f16';
import { buildCentroids, identifyCourse, scoreAreas, scoreCategories, softmax } from './identify';
import type { Video } from './types';

const DIMS = 4;
const unit = (...v: number[]): number[] => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const video = (vid: string, area: string, categories: string[]): Video => ({
  vid, title: vid, channel: 'c', summary: '', content_type: 'lecture', level: 'intro',
  primary_topic: '', tags: [], score: 1, categories, area,
});

// Two areas along axes 0 and 1; each has two categories (second axis tilts them apart).
const taxonomy: Taxonomy = {
  areas: [
    { id: 'A', name: 'Area A', categories: [
      { id: 'A1', name: 'A one', description: '' }, { id: 'A2', name: 'A two', description: '' } ] },
    { id: 'B', name: 'Area B', categories: [
      { id: 'B1', name: 'B one', description: '' }, { id: 'B2', name: 'B two', description: '' } ] },
  ],
};
const rows: [Video, number[]][] = [
  [video('a1', 'A', ['A1']), unit(1, 0.4, 0, 0)],
  [video('a1b', 'A', ['A1']), unit(1, 0.5, 0, 0)],
  [video('a2', 'A', ['A2']), unit(1, -0.4, 0, 0)],
  [video('b1', 'B', ['B1']), unit(0, 0, 1, 0.4)],
  [video('b2', 'B', ['B2']), unit(0, 0, 1, -0.4)],
];
const centroids = buildCentroids(rows.map((r) => r[0]), new Float32Array(rows.flatMap((r) => r[1])), DIMS, taxonomy);
const chunks = (...rs: number[][]): Float32Array => new Float32Array(rs.flat());

describe('identifyCourse (synthetic centroids)', () => {
  it.each([
    { name: 'area A, category A1', q: [unit(1, 0.45, 0, 0)], area: 'A', cat: 'A1' },
    { name: 'area A, category A2', q: [unit(1, -0.45, 0, 0)], area: 'A', cat: 'A2' },
    { name: 'area B, category B2', q: [unit(0, 0, 1, -0.4)], area: 'B', cat: 'B2' },
    { name: 'majority of chunks decides', q: [unit(0, 0, 1, 0.4), unit(0, 0, 1, 0.3), unit(1, 0, 0, 0)], area: 'B', cat: 'B1' },
  ])('$name', ({ q, area, cat }) => {
    for (const aggregation of ['mean', 'vote'] as const) {
      const r = identifyCourse(chunks(...q), centroids, { aggregation });
      expect(r?.area.id).toBe(area);
      expect(r?.categories[0].id).toBe(cat);
      expect(r?.method).toBe('embedding');
    }
  });

  it('keeps categories inside the chosen area', () => {
    const r = identifyCourse(chunks(unit(1, 0.2, 0.3, 0.1)), centroids)!;
    expect(r.area.id).toBe('A');
    expect(r.categories.map((c) => c.id).sort()).toEqual(['A1', 'A2']);
    expect(scoreCategories(chunks(unit(0, 0, 1, 0)), centroids, 'B').map((c) => c.id).sort()).toEqual(['B1', 'B2']);
  });

  it('confidences are probabilities summing to 1, best first', () => {
    for (const aggregation of ['mean', 'vote'] as const) {
      const areas = scoreAreas(chunks(unit(1, 0.3, 0.2, 0), unit(0.2, 0, 1, 0)), centroids, { aggregation });
      expect(areas.reduce((s, a) => s + a.confidence, 0)).toBeCloseTo(1, 6);
      expect(areas.every((a) => a.confidence >= 0 && a.confidence <= 1)).toBe(true);
      expect(areas[0].confidence).toBeGreaterThanOrEqual(areas[1].confidence);
      const cats = scoreCategories(chunks(unit(1, 0.3, 0.2, 0)), centroids, 'A', { aggregation });
      expect(cats.reduce((s, c) => s + c.confidence, 0)).toBeCloseTo(1, 6);
    }
  });

  it('is more confident when the document is clearly one area', () => {
    const clear = scoreAreas(chunks(unit(1, 0, 0, 0)), centroids)[0].confidence;
    const mixed = scoreAreas(chunks(unit(1, 0, 1, 0)), centroids)[0].confidence;
    expect(clear).toBeGreaterThan(mixed);
  });

  it('returns undefined for empty input and softmax is stable for large logits', () => {
    expect(identifyCourse(new Float32Array(0), centroids)).toBeUndefined();
    expect(softmax([1000, 999], 0.01).every(Number.isFinite)).toBe(true);
  });
});

describe('identifyCourse (real catalog)', () => {
  const dir = resolve(import.meta.dirname, '../../public/data');
  const videos = JSON.parse(readFileSync(resolve(dir, 'videos.json'), 'utf8')) as Video[];
  const tax = JSON.parse(readFileSync(resolve(dir, 'taxonomy.json'), 'utf8')) as Taxonomy;
  const buf = readFileSync(resolve(dir, 'video_emb.f16'));
  const emb = decodeF16(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const dims = emb.length / videos.length;

  it.each(['software', 'physics-space', 'life-sciences-health'])('identifies %s from video embeddings used as chunks', (areaId) => {
    // 6 videos of this area act as the PDF chunks; the catalog centroids are built without them.
    const picked = videos.map((_, i) => i).filter((i) => videos[i].area === areaId).slice(0, 6);
    const pickedSet = new Set(picked);
    const rest = videos.map((_, i) => i).filter((i) => !pickedSet.has(i));
    const restEmb = new Float32Array(rest.length * dims);
    rest.forEach((src, k) => restEmb.set(emb.subarray(src * dims, (src + 1) * dims), k * dims));
    const cen = buildCentroids(rest.map((i) => videos[i]), restEmb, dims, tax);
    const q = new Float32Array(picked.length * dims);
    picked.forEach((src, k) => q.set(emb.subarray(src * dims, (src + 1) * dims), k * dims));

    const r = identifyCourse(q, cen)!;
    expect(r.area.id).toBe(areaId);
    expect(r.area.confidence).toBeGreaterThan(0.5);
    const inArea = new Set(tax.areas.find((a) => a.id === areaId)!.categories.map((c) => c.id));
    expect(r.categories.length).toBeGreaterThan(0);
    expect(r.categories.every((c) => inArea.has(c.id))).toBe(true);
  });
});
