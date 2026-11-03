// Point Transformers.js at the ONNX Runtime files shipped inside the extension. By default it
// loads them from cdn.jsdelivr.net, which Manifest V3 forbids (no remote code).
import { env } from '@huggingface/transformers';
import ortFactoryUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';

export function configureLocalRuntime(): void {
  const abs = (u: string): string => new URL(u, document.baseURI).href;
  const wasm = env.backends.onnx.wasm;
  if (!wasm) throw new Error('ONNX Runtime WASM backend is unavailable');
  wasm.wasmPaths = { mjs: abs(ortFactoryUrl), wasm: abs(ortWasmUrl) };
  // The default wasm cache wraps the factory in a blob: URL, which the extension CSP blocks.
  env.useWasmCache = false;
  env.allowLocalModels = false; // model weights come from huggingface.co (data, not code)
}
