import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultDevice } from './embed';

// Regression: navigator.gpu existed but returned no adapter, and the model failed to load
// instead of falling back to WASM.
describe('defaultDevice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { name: 'no WebGPU API', nav: {}, want: 'wasm' },
    { name: 'API but no adapter', nav: { gpu: { requestAdapter: async () => null } }, want: 'wasm' },
    { name: 'adapter request throws', nav: { gpu: { requestAdapter: async () => { throw new Error('x'); } } }, want: 'wasm' },
    { name: 'working adapter', nav: { gpu: { requestAdapter: async () => ({}) } }, want: 'webgpu' },
  ])('$name -> $want', async ({ nav, want }) => {
    vi.stubGlobal('navigator', nav);
    expect(await defaultDevice()).toBe(want);
  });
});
