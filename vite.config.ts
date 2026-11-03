import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The web app lives in src/web; static data files are served from public/.
// base matches the GitHub Pages URL: https://<user>.github.io/study-hackertube/
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/web'),
  publicDir: resolve(import.meta.dirname, 'public'),
  base: '/study-hackertube/',
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
});
