// Server configuration. Everything comes from the environment; a local `.env` file is read first so
// development needs no extra tooling. No secret has a default, and none is ever sent to the browser.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
  }
}

loadDotEnv(path.resolve(process.cwd(), '.env'));

const env = (name: string, fallback = ''): string => {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
};
/** A value is "set" only when it is not one of the placeholders from .env.example. */
const secret = (name: string): string => {
  const v = env(name);
  return /^(your[-_ ]|changeme|placeholder|xxx|<)/i.test(v) ? '' : v;
};
const flag = (name: string, fallback: boolean): boolean => {
  const v = env(name).toLowerCase();
  return v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v);
};
const int = (name: string, fallback: number): number => {
  const n = Number(env(name));
  return Number.isFinite(n) && env(name) !== '' ? n : fallback;
};

export type ProviderName = 'gemini' | 'bedrock';

export const config = {
  port: int('PORT', 8787),
  host: env('HOST', '0.0.0.0'),
  staticDir: path.resolve(process.cwd(), env('STATIC_DIR', 'dist/client')),
  dataDir: path.resolve(process.cwd(), env('DATA_DIR', '.data')),
  sessionSecret: secret('SESSION_SECRET'),
  originSecret: secret('ORIGIN_SECRET'),
  trustProxy: flag('TRUST_PROXY', false),

  gemini: {
    key: secret('GEMINI_API_KEY'),
    /** Fastest current model: used for mantras, where every 100 ms is felt. */
    fastModel: env('GEMINI_FAST_MODEL', 'gemini-3.5-flash-lite'),
    /** Stronger model for researching and designing a summoned legend, and for the atelier. */
    smartModel: env('GEMINI_SMART_MODEL', 'gemini-3.8-flash'),
    fastThinking: env('GEMINI_FAST_THINKING', 'minimal'),
    smartThinking: env('GEMINI_SMART_THINKING', 'low'),
    apiRevision: env('GEMINI_API_REVISION', '2026-05-20'),
  },

  bedrock: {
    /** Off until switched on, so a developer's AWS credentials are never used by surprise. */
    enabled: flag('BEDROCK_ENABLED', false),
    region: env('BEDROCK_REGION', env('AWS_REGION', 'us-east-1')),
    fastModel: env('BEDROCK_FAST_MODEL', 'us.anthropic.claude-haiku-5-5'),
    smartModel: env('BEDROCK_SMART_MODEL', 'us.anthropic.claude-haiku-5-5'),
    /** Optional Bedrock API key. Without it the AWS SDK credential chain (instance role, profile) is used. */
    token: secret('AWS_BEARER_TOKEN_BEDROCK'),
  },

  supermemory: {
    key: secret('SUPERMEMORY_API_KEY'),
    namespace: env('SUPERMEMORY_NAMESPACE', 'mythic-strings-mantras'),
    threshold: Number(env('SUPERMEMORY_THRESHOLD', '0.82')),
  },

  store: {
    /** Empty means the JSON file store. Set it to use DynamoDB. */
    table: env('DYNAMODB_TABLE'),
    region: env('AWS_REGION', 'us-east-1'),
  },

  providerOrder: env('AI_PROVIDER_ORDER', 'gemini,bedrock')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderName => s === 'gemini' || s === 'bedrock'),

  /** Longest a mantra waits for a model before the built-in reader answers. */
  promptBudgetMs: int('PROMPT_BUDGET_MS', 2600),
  summonBudgetMs: int('SUMMON_BUDGET_MS', 25000),
  atelierBudgetMs: int('ATELIER_BUDGET_MS', 30000),
  /** AI requests allowed per client per minute, to protect the credit balance on a public URL. */
  aiPerMinute: int('AI_PER_MINUTE', 40),
  aiGlobalPerMinute: int('AI_GLOBAL_PER_MINUTE', 120),
  aiDailyLimit: int('AI_DAILY_LIMIT', 1500),
  aiSmartDailyLimit: int('AI_SMART_DAILY_LIMIT', 100),
  aiConcurrency: int('AI_CONCURRENCY', 8),
} as const;

export function aiStatus(): { gemini: boolean; bedrock: boolean; memory: boolean } {
  return { gemini: config.gemini.key !== '', bedrock: config.bedrock.enabled, memory: config.supermemory.key !== '' };
}
