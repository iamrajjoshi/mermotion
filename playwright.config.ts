import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
    },
  },
  testDir: './e2e',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'pnpm --filter @mermotion/engine build && pnpm --filter @mermotion/web build && pnpm --filter @mermotion/web preview --host 127.0.0.1',
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    url: 'http://127.0.0.1:4173',
  },
});
