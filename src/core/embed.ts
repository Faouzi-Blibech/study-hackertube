// Query/chunk embeddings with Transformers.js. Must match how HackerTube built video_emb.f16:
// BAAI/bge-small-en-v1.5, CLS pooling, L2 normalized, NO instruction prefix.
// Xenova/bge-small-en-v1.5 is the ONNX export of that model; dtype 'q8' loads
// onnx/model_quantized.onnx (same family as the fastembed quantized build).
import { pipeline } from '@huggingface/transformers';
import type { DataType, DeviceType, FeatureExtractionPipeline, ProgressInfo } from '@huggingface/transformers';

export const MODEL_ID = 'Xenova/bge-small-en-v1.5';
export const EMBED_DIMS = 384;

export interface EmbedOptions {
  /** Defaults to 'webgpu' when a GPU adapter is available, otherwise 'wasm'. Use 'cpu' in node. */
  device?: DeviceType;
  /** Defaults to 'q8'. */
  dtype?: DataType;
  /** Model download progress, 0..1. */
  onModelProgress?: (fraction: number) => void;
}

interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

/**
 * 'webgpu' only when the browser can actually hand out a GPU adapter. Many browsers expose
 * navigator.gpu but return no adapter (blocklisted driver, headless, remote desktop), so the
 * mere presence of the API is not enough.
 */
export async function defaultDevice(): Promise<DeviceType> {
  const gpu = typeof navigator !== 'undefined' ? (navigator as Navigator & { gpu?: GpuLike }).gpu : undefined;
  if (!gpu) return 'wasm';
  try {
    return (await gpu.requestAdapter()) ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let progressSink: ((fraction: number) => void) | undefined;

/** Lazy singleton: the first call decides device/dtype; later calls reuse the pipeline. */
export function getExtractor(opts: EmbedOptions = {}): Promise<FeatureExtractionPipeline> {
  progressSink = opts.onModelProgress;
  if (!extractorPromise) {
    const load = (device: DeviceType): Promise<FeatureExtractionPipeline> =>
      pipeline('feature-extraction', MODEL_ID, {
        device,
        dtype: opts.dtype ?? 'q8',
        progress_callback: (info: ProgressInfo) => {
          if (info.status === 'progress_total') progressSink?.(info.progress / 100);
        },
      });
    extractorPromise = (async () => {
      const device = opts.device ?? (await defaultDevice());
      try {
        return await load(device);
      } catch (err) {
        if (device !== 'webgpu') throw err;
        return load('wasm'); // WebGPU can still fail at session creation; WASM works everywhere
      }
    })().catch((err: unknown) => {
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
