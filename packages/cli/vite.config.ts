import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/browser-entry.ts', import.meta.url)),
      fileName: () => 'renderer.js',
      formats: ['iife'],
      name: 'MermotionCliRenderer',
    },
    license: { fileName: 'THIRD_PARTY_LICENSES.md' },
    outDir: fileURLToPath(new URL('./dist/browser', import.meta.url)),
    target: 'es2023',
  },
  root: packageRoot,
});
