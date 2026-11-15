import { defineConfig } from '@playwright/test';

const baseURL = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8792';
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 40_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined),
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.TEST_BASE_URL ? undefined : {
    command: 'node scripts/test-server.mjs',
    url: baseURL + '/api/health',
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
