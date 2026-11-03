import { describe, expect, it } from 'vitest';
import { assessCoverage } from './coverage';
import type { ChunkHit } from './retrieve';
import type { PdfChunk } from './types';

const chunk = (id: number, heading: string | null, text = 'some words about the topic'): PdfChunk => ({
  id,
  page: 1,
  heading,
  text,
});
const hit = (sim: number): ChunkHit[] => [{ videoIdx: 0, sim }];

describe('assessCoverage', () => {
  it.each([
    { name: 'all strong', sims: [0.8, 0.79, 0.76, 0.75], level: 'good', covered: 4 },
    { name: 'half weak', sims: [0.8, 0.78, 0.7, 0.65], level: 'partial', covered: 2 },
    { name: 'mostly weak', sims: [0.76, 0.7, 0.69, 0.66, 0.65], level: 'limited', covered: 1 },
    { name: 'threshold is inclusive', sims: [0.74], level: 'good', covered: 1 },
  ])('$name -> $level', ({ sims, level, covered }) => {
    const chunks = sims.map((_, i) => chunk(i, `H${i}`));
    const c = assessCoverage(chunks, sims.map(hit));
    expect(c.level).toBe(level);
    expect(c.coveredChunks).toBe(covered);
    expect(c.totalChunks).toBe(sims.length);
  });

  it('lists weak topics once each, by heading, falling back to the first words', () => {
    const chunks = [
      chunk(0, 'MapReduce'),
      chunk(1, 'MapReduce'),
      chunk(2, null, 'HDFS NameNode keeps the block map in memory and more text'),
      chunk(3, 'Linear algebra'),
    ];
    const c = assessCoverage(chunks, [hit(0.7), hit(0.68), hit(0.66), hit(0.8)]);
    expect(c.gaps).toEqual(['MapReduce', 'HDFS NameNode keeps the block map']);
  });

  it('treats a chunk with no hits as uncovered', () => {
    expect(assessCoverage([chunk(0, 'X')], [[]]).coveredChunks).toBe(0);
  });
});
