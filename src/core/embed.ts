// Query/chunk embeddings with Transformers.js. Must match how HackerTube built video_emb.f16:
// BAAI/bge-small-en-v1.5, CLS pooling, L2 normalized, NO instruction prefix.
// Xenova/bge-small-en-v1.5 is the ONNX export of that model; dtype 'q8' loads
// onnx/model_quantized.onnx (same family as the fastembed quantized build).
import { pipeline } from '@huggingface/transformers';
import type { DataType, DeviceType, FeatureExtractionPipeline, ProgressInfo } from '@huggingface/transformers';

export const MODEL_ID = 'Xenova/bge-small-en-v1.5';
export const EMBED_DIMS = 384;

export interface EmbedOptions {
  /** Defaults to 'webgpu' when navigator.gpu exists, otherwise 'wasm'. Use 'cpu' in node. */
  device?: DeviceType;
  /** Defaults to 'q8'. */
  dtype?: DataType;
  /** Model download progress, 0..1. */
  onModelProgress?: (fraction: number) => void;
}

export function defaultDevice(): DeviceType {
  return typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
}

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let progressSink: ((fraction: number) => void) | undefined;

/** Lazy singleton: the first call decides device/dtype; later calls reuse the pipeline. */
export function getExtractor(opts: EmbedOptions = {}): Promise<FeatureExtractionPipeline> {
  progressSink = opts.onModelProgress;
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_ID, {
      device: opts.device ?? defaultDevice(),
      dtype: opts.dtype ?? 'q8',
      progress_callback: (info: ProgressInfo) => {
        if (info.status === 'progress_total') progressSink?.(info.progress / 100);
      },
    }).catch((err: unknown) => {
      extractorPromise = null; // allow a retry after a failed download
      throw err;
    });
  }
  return extractorPromise;
}

/**
 * Embed texts in batches. Returns a flat row-major Float32Array [texts.length, 384],
 * each row L2-normalized. onBatch gets (done, total) after each batch.
 */
export async function embedTexts(
  texts: string[],
  opts: EmbedOptions & { batchSize?: number; onBatch?: (done: number, total: number) => void } = {},
): Promise<Float32Array> {
  const extractor = await getExtractor(opts);
  const batchSize = opts.batchSize ?? 8;
  const out = new Float32Array(texts.length * EMBED_DIMS);
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const tensor = await extractor(batch, { pooling: 'cls', normalize: true });
    const data = tensor.data as Float32Array;
    if (data.length !== batch.length * EMBED_DIMS) {
      throw new Error(`unexpected embedding size ${data.length} for ${batch.length} texts`);
    }
    out.set(data, i * EMBED_DIMS);
    opts.onBatch?.(Math.min(i + batchSize, texts.length), texts.length);
  }
  return out;
}
