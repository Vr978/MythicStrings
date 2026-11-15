import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'mythic-e2e-'));
const child = spawn(process.execPath, ['dist/server/index.cjs'], {
  stdio: 'inherit',
  env: {
    ...process.env, PORT: '8792', HOST: '127.0.0.1', DATA_DIR: dataDir, STATIC_DIR: 'dist/client',
    GEMINI_API_KEY: 'placeholder', SUPERMEMORY_API_KEY: 'placeholder', BEDROCK_ENABLED: 'false',
    DYNAMODB_TABLE: '', ORIGIN_SECRET: '', TRUST_PROXY: 'false', SESSION_SECRET: 'mythic-e2e-only-guest-signing-key-32-bytes',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGTERM'));
child.on('exit', code => { rmSync(dataDir, { recursive: true, force: true }); process.exit(code ?? 0); });
