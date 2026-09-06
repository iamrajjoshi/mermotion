import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      fileName: () => 'index.js',
      formats: ['es'],
    },
    minify: false,
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    rollupOptions: {
      external: [/^node:/, 'commander', 'dompurify', 'mermaid', 'playwright'],
      output: {
        codeSplitting: false,
      },
    },
    target: 'node24',
  },
  root: packageRoot,
});
