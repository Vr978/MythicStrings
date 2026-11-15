import { defineConfig } from 'vitest/config';

// The rules, the simulation and the AI normalisers are pure TypeScript, so they run in Node.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
