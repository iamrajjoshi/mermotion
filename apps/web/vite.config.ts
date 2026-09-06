import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { normalizeBasePath } from './src/base-path.ts';

export default defineConfig({
  base: normalizeBasePath(process.env.MERMOTION_BASE_PATH),
  plugins: [react()],
  // In development Vite serves the renderer as an ES module. Its sandboxed srcdoc has the
  // opaque `null` origin, so allow only that origin to load the module graph.
  server: {
    cors: { origin: 'null' },
  },
});
