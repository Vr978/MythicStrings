// One entry point for every model call. Providers are tried in the configured order inside a single
// time budget; the caller always has a non-AI fallback, so a slow or failing provider only costs time.
import type { Citation } from '../../shared/types';
import { aiStatus, config, type ProviderName } from '../config';
import { bedrock } from './bedrock';
import { gemini, type GeminiPart } from './gemini';

export interface LlmRequest {
  /** fast: mantras. smart: research, design and drawing. */
  tier: 'fast' | 'smart';
  system: string;
  user: string;
  /** JSON Schema for the answer. */
  schema?: object;
  image?: { mime: string; b64: string };
  /** Ground in live web search (Gemini only; other providers answer from what they know). */
  search?: boolean;
  maxTokens?: number;
  budgetMs: number;
  /** Restrict to these providers. */
  only?: ProviderName[];
}

export interface LlmResult {
  text: string;
  provider: ProviderName;
  model: string;
  citations: Citation[];
  ms: number;
}

export function activeProviders(): ProviderName[] {
  const s = aiStatus();
  return config.providerOrder.filter((p) => (p === 'gemini' ? s.gemini : s.bedrock));
}

/** Finds the JSON object in a model's answer, tolerating code fences and stray prose. */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('model answer was not JSON');
  }
}

const errors: { at: number; provider: string; message: string }[] = [];
let budgetDay = '';
let dailyCalls = 0;
let smartCalls = 0;
let concurrent = 0;
let minuteCalls: number[] = [];

/** Process-wide ceilings supplement client limits, including calls made over WebSockets. */
function reserve(tier: LlmRequest['tier']): void {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== budgetDay) { budgetDay = day; dailyCalls = 0; smartCalls = 0; }
  const now = Date.now();
  minuteCalls = minuteCalls.filter(t => now - t < 60_000);
  if (dailyCalls >= config.aiDailyLimit || (tier === 'smart' && smartCalls >= config.aiSmartDailyLimit) ||
      minuteCalls.length >= config.aiGlobalPerMinute || concurrent >= config.aiConcurrency) {
    throw new Error('AI request allowance reached; using the local reader');
  }
  minuteCalls.push(now); dailyCalls++; if (tier === 'smart') smartCalls++;
}

export function aiUsage(): { day: string; calls: number; smart: number; concurrent: number } {
  return { day: budgetDay, calls: dailyCalls, smart: smartCalls, concurrent };
}

/** The most recent provider failures, for the health endpoint and the doctor script. */
export function recentErrors(): typeof errors {
  return errors.slice(-5);
}

async function callProvider(p: ProviderName, req: LlmRequest, signal: AbortSignal): Promise<Omit<LlmResult, 'ms'>> {
  const maxTokens = req.maxTokens ?? 700;
  if (p === 'gemini') {
    const model = req.tier === 'fast' ? config.gemini.fastModel : config.gemini.smartModel;
    const input: string | GeminiPart[] = req.image
      ? [{ type: 'text', text: req.user }, { type: 'image', data: req.image.b64, mime_type: req.image.mime }]
      : req.user;
    const out = await gemini({
      model, system: req.system, input, maxTokens, signal,
      thinking: req.tier === 'fast' ? config.gemini.fastThinking : config.gemini.smartThinking,
      ...(req.schema ? { schema: req.schema } : {}),
      ...(req.search ? { search: true } : {}),
    });
    return { text: out.text, provider: p, model, citations: out.citations };
  }
  const model = req.tier === 'fast' ? config.bedrock.fastModel : config.bedrock.smartModel;
  const system = req.schema
    ? `${req.system}\n\nAnswer with one JSON object and nothing else: no prose, no code fence. It must match this JSON Schema:\n${JSON.stringify(req.schema)}`
    : req.system;
  const text = await bedrock({ model, system, user: req.user, maxTokens, signal, ...(req.image ? { image: req.image } : {}) });
  return { text, provider: p, model, citations: [] };
}

/** Tries each provider until one answers. Throws when none is configured or all fail within the budget. */
export async function llm(req: LlmRequest): Promise<LlmResult> {
  const started = Date.now();
  const deadline = started + req.budgetMs;
  const providers = activeProviders().filter((p) => !req.only || req.only.includes(p));
  if (providers.length === 0) throw new Error('no AI provider is configured');
  reserve(req.tier);
  concurrent++;
  try {
  let last: unknown = new Error('no provider answered');
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!;
    const remaining = deadline - Date.now();
    if (remaining < 250) break;
    // Leave the next provider a fair share of the budget instead of letting the first one use it all.
    const share = i < providers.length - 1 ? Math.max(remaining * 0.65, Math.min(remaining, 1200)) : remaining;
    try {
      const out = await callProvider(p, req, AbortSignal.timeout(Math.round(share)));
      return { ...out, ms: Date.now() - started };
    } catch (err) {
      last = err;
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ at: Date.now(), provider: p, message: message.slice(0, 240) });
      if (errors.length > 20) errors.shift();
      console.warn(`[ai] ${p} failed: ${message.slice(0, 200)}`);
    }
  }
    throw last instanceof Error ? last : new Error(String(last));
  } finally { concurrent--; }
}
