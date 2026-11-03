import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Chrome extension (Manifest V3) build. Shares src/core with the web app.
// Output: dist-extension/ (load unpacked, or zip for the Web Store).
const root = resolve(import.meta.dirname, 'src/extension');

/** Emits manifest.json and icons/ without extra dependencies. */
function extensionAssets(): Plugin {
  return {
    name: 'extension-assets',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: readFileSync(resolve(root, 'manifest.json'), 'utf8'),
      });
      const iconDir = resolve(root, 'icons');
      for (const name of readdirSync(iconDir)) {
        this.emitFile({ type: 'asset', fileName: `icons/${name}`, source: readFileSync(resolve(iconDir, name)) });
      }
    },
  };
}

export default defineConfig({
  root,
  publicDir: resolve(import.meta.dirname, 'public'), // data/ is packaged with the extension
  base: './',
  plugins: [extensionAssets()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist-extension'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        sidepanel: resolve(root, 'sidepanel.html'),
        background: resolve(root, 'background.ts'),
      },
      output: {
        // The service worker must keep a stable file name for the manifest.
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
