import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  use: {
    baseURL,
    trace: 'off',
  },
  webServer: {
    command: 'node scripts/serve-dist.mjs',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      BASE_PATH: process.env.BASE_PATH ?? '/',
      PORT: '4173',
    },
  },
});
