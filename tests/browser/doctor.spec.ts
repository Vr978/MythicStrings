import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

test('doctor verifies the served build and creates a two-seat WebSocket room', async ({ baseURL }) => {
  const result = spawnSync(process.execPath, ['scripts/doctor.mjs', '--url', baseURL!, '--online'], {
    encoding: 'utf8', timeout: 15_000,
  });
  expect(result.status, result.stderr || result.error?.message || result.stdout).toBe(0);
  expect(result.stdout).toContain('PASS client and roster');
  expect(result.stdout).toContain('PASS WebSocket');
  expect(result.stdout).toContain('The theatre checks passed.');
});
