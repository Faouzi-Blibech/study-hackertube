// Does HackerTube's catalog actually cover this course?
//
// Retrieval always returns *something*, even for topics HackerTube has no video on. To tell the
// student honestly, we look at each chunk's best video similarity (cosine, bge-small space):
//   >= COVERAGE_THRESHOLD  the catalog has a video about this part of the course
//   <  COVERAGE_THRESHOLD  only loosely related videos exist (a gap in the source data)
// Calibrated on 2026-11-03: topics HackerTube covers (linear algebra, transformers, Rust lifetimes,
// backprop) scored 0.76-0.82; topics it lacks (Hadoop MapReduce, HDFS, PLC ladder logic, VHDL,
// bookkeeping, organic chemistry) scored 0.65-0.73. See LEARNING.md, "Coverage notice".
import type { ChunkHit } from './retrieve';
import { shortTitle } from './text';
import type { Coverage, PdfChunk } from './types';

export const COVERAGE_THRESHOLD = 0.74;
const GOOD_SHARE = 0.6; // at least 60% of chunks covered -> good
const PARTIAL_SHARE = 0.3; // at least 30% -> partial, below -> limited
const MAX_GAPS = 5;
const GAP_WORDS = 6;

function label(chunk: PdfChunk): string {
  if (chunk.heading) return shortTitle(chunk.heading, 40);
  return chunk.text.trim().split(/\s+/).slice(0, GAP_WORDS).join(' ');
}

/** hitsPerChunk[i] are chunk i's best videos, best first (as from topVideosPerChunk). */
export function assessCoverage(chunks: PdfChunk[], hitsPerChunk: ChunkHit[][]): Coverage {
  let covered = 0;
  const gaps: string[] = [];
  chunks.forEach((chunk, i) => {
    const best = hitsPerChunk[i]?.[0]?.sim ?? -1;
    if (best >= COVERAGE_THRESHOLD) {
      covered++;
      return;
    }
    const name = label(chunk);
    if (name && !gaps.includes(name) && gaps.length < MAX_GAPS) gaps.push(name);
  });
  const share = chunks.length ? covered / chunks.length : 0;
  const level = share >= GOOD_SHARE ? 'good' : share >= PARTIAL_SHARE ? 'partial' : 'limited';
  return { level, coveredChunks: covered, totalChunks: chunks.length, gaps };
}
