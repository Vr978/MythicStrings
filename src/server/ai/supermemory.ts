// Supermemory (v5, namespace-scoped API) as the game's long memory. Two uses:
//  - a semantic cache of mantras: a prompt that means the same as one already judged is answered
//    from memory in a fraction of the time a model takes;
//  - a per-player chronicle of past duels.
// Everything here fails soft: without a key, or on any error, the game simply carries on.
import { config } from '../config';

const BASE = 'https://api.supermemory.ai';

export function memoryEnabled(): boolean {
  return config.supermemory.key !== '';
}

async function call(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.supermemory.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`supermemory: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}

export interface Recalled {
  /** The JSON string stored with the document. */
  payload: string;
  similarity: number;
}

interface SearchResult {
  similarity?: number;
  metadata?: Record<string, unknown> | null;
}

/** Best stored match above the similarity threshold, or null. */
export function pickRecall(body: unknown, threshold: number): Recalled | null {
  const results = ((body ?? {}) as { results?: SearchResult[] }).results ?? [];
  let best: Recalled | null = null;
  for (const r of results) {
    const payload = r.metadata?.payload;
    const similarity = typeof r.similarity === 'number' ? r.similarity : 0;
    if (typeof payload !== 'string' || similarity < threshold) continue;
    if (!best || similarity > best.similarity) best = { payload, similarity };
  }
  return best;
}

/** Looks for a stored entry that means the same as `query`. */
export async function recall(namespace: string, query: string, timeoutMs = 450): Promise<Recalled | null> {
  if (!memoryEnabled()) return null;
  try {
    const body = await call(`/ns/${encodeURIComponent(namespace)}/search`, { query, searchMode: 'hybrid', limit: 3, threshold: config.supermemory.threshold }, timeoutMs);
    return pickRecall(body, config.supermemory.threshold);
  } catch (err) {
    console.warn(`[memory] recall failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Stores `content` with a JSON payload in its metadata. Never throws, never blocks the caller. */
export function remember(namespace: string, content: string, payload: string, id?: string): void {
  if (!memoryEnabled()) return;
  void call(
    `/ns/${encodeURIComponent(namespace)}/document`,
    // "instant" makes a short text searchable within seconds instead of minutes.
    { content, metadata: { payload, kind: 'mythic-strings' }, dreaming: 'instant', ...(id ? { id: id.slice(0, 200) } : {}) },
    8000,
  ).catch((err) => console.warn(`[memory] remember failed: ${err instanceof Error ? err.message : String(err)}`));
}

/** Recent memories for a namespace as plain text lines, for the narrator. */
export async function recallText(namespace: string, query: string, limit = 3, timeoutMs = 900): Promise<string[]> {
  if (!memoryEnabled()) return [];
  try {
    const body = (await call(`/ns/${encodeURIComponent(namespace)}/search`, { query, searchMode: 'hybrid', limit, threshold: 0.2 }, timeoutMs)) as {
      results?: { memory?: string; chunk?: string }[];
    };
    return (body.results ?? []).map((r) => (r.memory ?? r.chunk ?? '').trim()).filter(Boolean).slice(0, limit);
  } catch {
    return [];
  }
}
