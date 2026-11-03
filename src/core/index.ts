// Single entry point for the UI: PDF file in, chunks and ranked video matches out.
// Everything runs in the browser; the PDF is never uploaded.
import type { Match, PdfChunk } from './types';
import { chunkEmbeddingText, chunkPages } from './chunk';
import { loadSegments, loadVideoIndex } from './data';
import { embedTexts } from './embed';
import { extractPdf } from './pdf';
import { retrieve } from './retrieve';

export type Stage = 'extract' | 'chunk' | 'model' | 'embed' | 'retrieve' | 'done';

export interface Progress {
  stage: Stage;
  /** 0..1 within the stage. */
  fraction: number;
  message: string;
}

export interface AnalysisResult {
  chunks: PdfChunk[];
  matches: Match[];
}

export async function analyzePdf(file: File, onProgress: (p: Progress) => void = () => {}): Promise<AnalysisResult> {
  const report = (stage: Stage, fraction: number, message: string): void => onProgress({ stage, fraction, message });

  report('extract', 0, 'Reading PDF');
  const pages = await extractPdf(file);
  report('extract', 1, `Read ${pages.length} pages`);

  const chunks = chunkPages(pages);
  report('chunk', 1, `Split into ${chunks.length} chunks`);
  if (chunks.length === 0) {
    report('done', 1, 'No readable text found in this PDF');
    return { chunks, matches: [] };
  }

  report('model', 0, 'Loading embedding model');
  const [index, chunkEmb] = await Promise.all([
    loadVideoIndex(),
    embedTexts(chunks.map(chunkEmbeddingText), {
      onModelProgress: (f) => report('model', f, 'Downloading embedding model'),
      onBatch: (done, total) => report('embed', done / total, `Embedded ${done} of ${total} chunks`),
    }),
  ]);

  report('retrieve', 0, 'Finding videos');
  const matches = await retrieve(chunks, chunkEmb, index.videos, index.embeddings, index.dims, loadSegments);
  report('done', 1, `Found ${matches.length} videos`);
  return { chunks, matches };
}

export type { Match, PdfChunk, Segment, Video } from './types';
