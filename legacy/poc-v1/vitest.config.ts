import { defineConfig } from 'vitest/config';

// core, sim, ai, and content tests are pure logic or headless physics, so they run in Node.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
