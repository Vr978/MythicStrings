// Gemini through the Interactions API (POST /v1beta/interactions), called with plain fetch.
// Shapes follow the documentation as of Api-Revision 2026-05-20: text comes back in
// steps[type=model_output].content[type=text].text, with url_citation annotations when grounded.
import type { Citation } from '../../shared/types';
import { config } from '../config';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export type GeminiPart = { type: 'text'; text: string } | { type: 'image'; data: string; mime_type: string };

export interface GeminiRequest {
  model: string;
  system: string;
  input: string | GeminiPart[];
  /** JSON Schema: asks for application/json constrained to it. */
  schema?: object;
  /** Ground the answer in Google Search results. */
  search?: boolean;
  thinking?: string;
  maxTokens: number;
  signal: AbortSignal;
}

export interface GeminiResult {
  text: string;
  citations: Citation[];
}

interface Step {
  type?: string;
  content?: { type?: string; text?: string; annotations?: { type?: string; url?: string; title?: string }[] }[];
}

/** Pulls the answer text and any citations out of an Interaction object. */
export function parseInteraction(body: unknown): GeminiResult {
  const b = (body ?? {}) as { status?: string; steps?: Step[]; outputs?: { type?: string; text?: string }[]; errors?: { message?: string }[] };
  if (b.status === 'failed' || b.status === 'cancelled') throw new Error(`gemini: interaction ${b.status}: ${b.errors?.[0]?.message ?? 'no detail'}`);
  let text = '';
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const step of b.steps ?? []) {
    if (step.type !== 'model_output') continue;
    for (const part of step.content ?? []) {
      if (part.type !== 'text' || typeof part.text !== 'string') continue;
      text += part.text;
      for (const a of part.annotations ?? []) {
        if (a.type !== 'url_citation' || !a.url || seen.has(a.url)) continue;
        seen.add(a.url);
        citations.push({ title: a.title || a.url, url: a.url });
      }
    }
  }
  // Earlier revisions of the API returned a flat `outputs` array; accept it so a revision pin cannot break us.
  if (!text) for (const o of b.outputs ?? []) if (o.type === 'text' && typeof o.text === 'string') text += o.text;
  if (!text.trim()) throw new Error(`gemini: empty answer (status ${b.status ?? 'unknown'})`);
  return { text, citations };
}

export function buildBody(req: GeminiRequest, withTuning: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    input: req.input,
    system_instruction: req.system,
    // Nothing a player types needs to be kept on Google's side.
    store: false,
  };
  // Retain the output ceiling when retrying a model that rejects a thinking-level option.
  body.generation_config = { max_output_tokens: req.maxTokens, ...(withTuning && req.thinking ? { thinking_level: req.thinking } : {}) };
  if (req.search) body.tools = [{ type: 'google_search' }];
  else if (req.schema) body.response_format = { type: 'text', mime_type: 'application/json', schema: req.schema };
  return body;
}

export async function gemini(req: GeminiRequest): Promise<GeminiResult> {
  const call = async (withTuning: boolean): Promise<Response> =>
    fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-goog-api-key': config.gemini.key,
        'Content-Type': 'application/json',
        'Api-Revision': config.gemini.apiRevision,
      },
      body: JSON.stringify(buildBody(req, withTuning)),
      signal: req.signal,
    });
  let res = await call(true);
  // A model that does not accept the requested thinking level answers 400: retry once with defaults.
  if (res.status === 400) res = await call(false);
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`gemini: HTTP ${res.status} ${detail}`);
  }
  return parseInteraction(await res.json());
}
