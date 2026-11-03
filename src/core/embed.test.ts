// Compatibility check: Transformers.js (Xenova/bge-small-en-v1.5, q8) must produce vectors
// that live in the same space as HackerTube's precomputed video_emb.f16.
// Downloads the model from Hugging Face on first run. Skip offline with OFFLINE=1.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeF16 } from './f16';
import { EMBED_DIMS, embedTexts } from './embed';
import { topVideosPerChunk } from './retrieve';
import type { Video } from './types';

const root = resolve(import.meta.dirname, '../..');
const videos = JSON.parse(readFileSync(resolve(root, 'public/data/videos.json'), 'utf8')) as Video[];
const file = readFileSync(resolve(root, 'public/data/video_emb.f16'));
const videoEmb = decodeF16(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);

describe.skipIf(process.env['OFFLINE'] === '1')('Transformers.js vs HackerTube embeddings', () => {
  it('finds each video by its own title in the top 10 (at least 2 of 3)', async () => {
    const rows = [0, 10, 100];
    const q = await embedTexts(rows.map((r) => videos[r]!.title), { device: 'cpu' });
    const hits = topVideosPerChunk(q, videoEmb, EMBED_DIMS, 10);
    const ranks = rows.map((r, i) => hits[i]!.findIndex((h) => h.videoIdx === r)); // -1 when absent
    console.log('self-retrieval ranks (0-based, -1 = not in top 10):', JSON.stringify(ranks), rows.map((r) => videos[r]!.title));
    expect(ranks.filter((x) => x >= 0).length).toBeGreaterThanOrEqual(2);
  }, 300_000);

  it('MapReduce query lands on relevant videos', async () => {
    const q = await embedTexts(['MapReduce and Hadoop distributed data processing'], { device: 'cpu' });
    const top = topVideosPerChunk(q, videoEmb, EMBED_DIMS, 5)[0]!;
    console.log('MapReduce top 5:');
    for (const h of top) console.log(`  ${h.sim.toFixed(3)}  ${videos[h.videoIdx]!.title}  [${videos[h.videoIdx]!.channel}]`);
    expect(top[0]!.sim).toBeGreaterThan(0.5);
  }, 300_000);
});
