import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// vite.config.ts sets root to src/web; tests live in src/core, so use the repo root here.
export default defineConfig({
  root: resolve(import.meta.dirname),
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
