import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      provider: 'v8',
    },
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'apps/**/*.test.tsx'],
  },
});
