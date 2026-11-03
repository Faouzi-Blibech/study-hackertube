// Decision 1: which course is this? Pure functions, no I/O.
//
// Method (see eval/decisions.md): for every taxonomy area and category, the centroid is the mean
// of the L2-normalized embeddings of the catalog videos filed under it (first category wins,
// same rule as Video.area), re-normalized. A PDF is identified by the cosine of its chunk
// embeddings to those centroids.
//
// Aggregation over chunks: 'mean' (average the chunk embeddings, re-normalize, one softmax).
// On 300 pseudo-courses (8 same-category videos as chunks, leave-out centroids) it beat
// per-chunk voting: area 92.3% vs 89.7%, category 91.7% vs 87.7%; with 3 off-topic chunks mixed
// in, 90.7% vs 88.3% area. 'vote' stays available for comparison.
//
// Confidence = softmax(cosine / T) over the 16 areas. T is calibrated by minimizing the
// negative log-likelihood of the gold area on the leave-one-out 300-video benchmark in
// scripts/eval_decisions.py: AREA_TEMPERATURE = 0.015 and CATEGORY_TEMPERATURE = 0.015 (grid 0.005..0.15, both minima at 0.015).
// Single-video benchmark accuracy of this method: area 72.0%, category 59.0% (83.7% given the gold area);
// whole PDFs average many chunks and are far more reliable. Laya zero-shot scored 35.3% area, so it is not used.
// Categories are restricted to the chosen area and their confidence is conditional on that area
// (softmax over the area's categories only), so it sums to 1 inside the area.
import type { Taxonomy } from './data';
import type { CourseIdentity, Video } from './types';

export const AREA_TEMPERATURE = 0.015;
export const CATEGORY_TEMPERATURE = 0.015;
export const MAX_CATEGORIES = 3;

export type Aggregation = 'mean' | 'vote';
export const DEFAULT_AGGREGATION: Aggregation = 'mean';

interface Centroid {
  id: string;
  name: string;
  vec: Float32Array;
}

export interface CourseCentroids {
  dims: number;
  areas: Centroid[];
  /** Each category belongs to exactly one area; categories without any video are left out. */
  categories: (Centroid & { areaId: string })[];
}

export interface IdentifyOptions {
  aggregation?: Aggregation;
  areaTemperature?: number;
  categoryTemperature?: number;
}

function normalize(v: Float32Array): void {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
}

/** Centroids from the catalog: mean embedding per area and per category (first category of each video). */
export function buildCentroids(
  videos: Video[],
  embeddings: Float32Array,
  dims: number,
  taxonomy: Taxonomy,
): CourseCentroids {
  const areaSum = new Map<string, Float32Array>();
  const catSum = new Map<string, Float32Array>();
  const add = (map: Map<string, Float32Array>, key: string, row: number): void => {
    let acc = map.get(key);
    if (!acc) map.set(key, (acc = new Float32Array(dims)));
    for (let d = 0; d < dims; d++) acc[d] += embeddings[row * dims + d];
  };
  videos.forEach((v, row) => {
    if (v.area) add(areaSum, v.area, row);
    if (v.categories[0]) add(catSum, v.categories[0], row);
  });

  const areas: Centroid[] = [];
  const categories: CourseCentroids['categories'] = [];
  for (const a of taxonomy.areas) {
    const av = areaSum.get(a.id);
    if (av) {
      normalize(av);
      areas.push({ id: a.id, name: a.name, vec: av });
    }
    for (const c of a.categories) {
      const cv = catSum.get(c.id);
      if (!cv) continue;
      normalize(cv);
      categories.push({ id: c.id, name: c.name, vec: cv, areaId: a.id });
    }
  }
  return { dims, areas, categories };
}

function dot(a: Float32Array, b: Float32Array, bOffset = 0): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[bOffset + i];
  return s;
}

/** Softmax of x / temperature; numerically stable, sums to 1. */
export function softmax(x: number[], temperature: number): number[] {
  if (x.length === 0) return [];
  const max = Math.max(...x);
  const e = x.map((v) => Math.exp((v - max) / temperature));
  const sum = e.reduce((s, v) => s + v, 0);
  return e.map((v) => v / sum);
}

/** Probability of each centroid given the chunk embeddings (row-major [n, dims]); sums to 1. */
export function centroidProbabilities(
  chunkEmb: Float32Array,
  dims: number,
  centroids: Float32Array[],
  temperature: number,
  aggregation: Aggregation,
): number[] {
  const n = Math.floor(chunkEmb.length / dims);
  if (n === 0 || centroids.length === 0) return centroids.map(() => (centroids.length ? 1 / centroids.length : 0));
  if (aggregation === 'mean') {
    const mean = new Float32Array(dims);
    for (let r = 0; r < n; r++) for (let d = 0; d < dims; d++) mean[d] += chunkEmb[r * dims + d];
    normalize(mean);
    return softmax(centroids.map((c) => dot(c, mean)), temperature);
  }
  const acc = centroids.map(() => 0);
  for (let r = 0; r < n; r++) {
    const p = softmax(centroids.map((c) => dot(c, chunkEmb, r * dims)), temperature);
    for (let k = 0; k < p.length; k++) acc[k] += p[k] / n;
  }
  return acc;
}

/** All areas with their confidence (sums to 1), best first. */
export function scoreAreas(
  chunkEmb: Float32Array,
  centroids: CourseCentroids,
  opts: IdentifyOptions = {},
): { id: string; name: string; confidence: number }[] {
  const p = centroidProbabilities(
    chunkEmb,
    centroids.dims,
    centroids.areas.map((a) => a.vec),
    opts.areaTemperature ?? AREA_TEMPERATURE,
    opts.aggregation ?? DEFAULT_AGGREGATION,
  );
  return centroids.areas
    .map((a, i) => ({ id: a.id, name: a.name, confidence: p[i] }))
    .sort((x, y) => y.confidence - x.confidence);
}

/** The categories of one area with their confidence inside that area (sums to 1), best first. */
export function scoreCategories(
  chunkEmb: Float32Array,
  centroids: CourseCentroids,
  areaId: string,
  opts: IdentifyOptions = {},
): { id: string; name: string; confidence: number }[] {
  const inArea = centroids.categories.filter((c) => c.areaId === areaId);
  const p = centroidProbabilities(
    chunkEmb,
    centroids.dims,
    inArea.map((c) => c.vec),
    opts.categoryTemperature ?? CATEGORY_TEMPERATURE,
    opts.aggregation ?? DEFAULT_AGGREGATION,
  );
  return inArea
    .map((c, i) => ({ id: c.id, name: c.name, confidence: p[i] }))
    .sort((x, y) => y.confidence - x.confidence);
}

/** Decision 1 for a PDF: undefined when there is nothing to identify (no chunks or no centroids). */
export function identifyCourse(
  chunkEmb: Float32Array,
  centroids: CourseCentroids,
  opts: IdentifyOptions = {},
): CourseIdentity | undefined {
  if (chunkEmb.length < centroids.dims || centroids.areas.length === 0) return undefined;
  const area = scoreAreas(chunkEmb, centroids, opts)[0];
  const categories = scoreCategories(chunkEmb, centroids, area.id, opts).slice(0, MAX_CATEGORIES);
  return { area, categories, method: 'embedding' };
}
