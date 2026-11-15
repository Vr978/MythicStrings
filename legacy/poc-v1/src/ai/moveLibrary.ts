// Move_Library adapter (design: "Move_Library"). The interface is async so a PostgreSQL + pgvector
// backend can replace `LocalMoveLibrary` without changing callers. The local version keeps entries
// in memory and mirrors them to one localStorage key when a Storage is available.
import { canonicalKey } from '../core/moveblock/equivalence';
import { parseMoveBlock } from '../core/moveblock/parse';
import { createDefaultRegistry } from '../core/moveblock/primitiveSchemas';
import { printMoveBlock } from '../core/moveblock/print';
import type { RegistryView } from '../core/moveblock/registry';
import { err, ok, type MoveBlock, type Result } from '../core/moveblock/types';
import { compareCandidates, pickBest } from '../core/library/pickBest';
import type { LibraryEntry, NearestResult, Scored } from '../core/library/types';
import { cosine, termVector, type TermVector, type VectorOptions } from '../core/text/similarity';

export type { LibraryEntry, NearestResult } from '../core/library/types';

export interface LibError {
  /** `invalid_block`: the block does not conform to the schema; `storage_failed`: the write failed. */
  kind: 'invalid_block' | 'storage_failed';
  reason: string;
}

export interface StoreOutcome {
  entry: LibraryEntry;
  /** True when a new entry was created; false when the prompt was linked to an equivalent entry. */
  created: boolean;
}

export interface MoveLibrary {
  /**
   * Best entry for `prompt` with its Similarity_Score in [0, 1] (Req 14.2, 14.7). The 200 ms deadline
   * and the "error means no match" rule (Req 14.9) are the caller's job.
   */
  nearest(prompt: string): Promise<Result<NearestResult, LibError>>;
  /** Up to `k` entries with a positive score, best first. Also matches display names and descriptions. */
  topK(prompt: string, k: number): Promise<LibraryEntry[]>;
  /**
   * Stores an accepted block (Req 14.1). Equivalent blocks (same `canonicalKey`) link the prompt to the
   * existing entry (Req 14.6). The caller passes only Guardrail-accepted or rewritten prompts (Req 10.8).
   */
  store(block: MoveBlock, prompt: string, creatorId: string): Promise<Result<StoreOutcome, LibError>>;
  /** Adds exactly 1 to the entry's usage count (Req 14.5). Unknown IDs are ignored. */
  incrementUsage(entryId: string): Promise<void>;
  size(): Promise<number>;
  /** Read-only copies of every entry in creation order (used to rank recommendations). */
  all(): Promise<LibraryEntry[]>;
}

/** The subset of the Web Storage API the library uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocalMoveLibraryOptions {
  /** Defaults to `globalThis.localStorage` when usable; `null` forces memory-only. */
  storage?: StorageLike | null;
  storageKey?: string;
  registry?: RegistryView;
  /** Milliseconds since the epoch; defaults to `Date.now`. */
  now?: () => number;
  /** Entry ID generator; defaults to `crypto.randomUUID`. */
  newId?: () => string;
}

export const DEFAULT_STORAGE_KEY = 'mythic-strings.move-library.v1';

/**
 * Reuse matching ignores number tokens, so "fire 50 arrows" and "fire 10 arrows" score 1.0 and the
 * Move_Generator adjusts the quantities instead (Req 14.4). Exact matching still compares full text.
 */
const MATCH_OPTS: VectorOptions = { ignoreNumbers: true };

interface StoredRecord {
  id: string;
  canonicalKey: string;
  block: string;
  creatorId: string;
  createdAt: number;
  usageCount: number;
  prompts: string[];
}

interface Indexed {
  entry: LibraryEntry;
  promptSet: Set<string>;
  promptVectors: TermVector[];
  /** Display name plus description, for typing suggestions. */
  textVector: TermVector;
}

function detectStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null;
  } catch {
    // Accessing localStorage can throw (privacy mode, Node without a backing file).
    return null;
  }
}

function defaultId(): () => string {
  let n = 0;
  return () => globalThis.crypto?.randomUUID?.() ?? `entry-${Date.now().toString(36)}-${++n}`;
}

const snapshot = (e: LibraryEntry): LibraryEntry => structuredClone(e);

function index(entry: LibraryEntry): Indexed {
  return {
    entry,
    promptSet: new Set(entry.prompts),
    promptVectors: entry.prompts.map((p) => termVector(p, MATCH_OPTS)),
    textVector: termVector(`${entry.block.displayName} ${entry.block.description}`, MATCH_OPTS),
  };
}

function promptScore(ix: Indexed, prompt: string, query: TermVector): number {
  if (ix.promptSet.has(prompt)) return 1;
  let best = 0;
  for (const v of ix.promptVectors) best = Math.max(best, cosine(query, v));
  return best;
}

export class LocalMoveLibrary implements MoveLibrary {
  readonly #storage: StorageLike | null;
  readonly #key: string;
  readonly #registry: RegistryView;
  readonly #now: () => number;
  readonly #newId: () => string;
  /** Insertion order is creation order. */
  #entries: Indexed[] = [];
  #byKey = new Map<string, Indexed>();
  #byId = new Map<string, Indexed>();

  constructor(opts: LocalMoveLibraryOptions = {}) {
    this.#storage = opts.storage === undefined ? detectStorage() : opts.storage;
    this.#key = opts.storageKey ?? DEFAULT_STORAGE_KEY;
    this.#registry = opts.registry ?? createDefaultRegistry();
    this.#now = opts.now ?? Date.now;
    this.#newId = opts.newId ?? defaultId();
    this.#load();
  }

  async nearest(prompt: string): Promise<Result<NearestResult, LibError>> {
    // Exact hits skip similarity search, so a non-exact entry that also scores 1.0 cannot win on usage.
    const exact = this.#entries.filter((ix) => ix.promptSet.has(prompt));
    let candidates: Scored<LibraryEntry>[];
    if (exact.length > 0) {
      candidates = exact.map((ix) => ({ entry: ix.entry, score: 1 }));
    } else {
      const query = termVector(prompt, MATCH_OPTS);
      candidates = this.#entries.map((ix) => ({ entry: ix.entry, score: promptScore(ix, prompt, query) }));
    }
    const best = pickBest(candidates);
    return ok({ entry: best.entry && snapshot(best.entry), score: best.score });
  }

  async topK(prompt: string, k: number): Promise<LibraryEntry[]> {
    if (!(k >= 1)) return [];
    const query = termVector(prompt, MATCH_OPTS);
    const scored: (Scored<LibraryEntry> & { exact: boolean })[] = [];
    for (const ix of this.#entries) {
      const exact = ix.promptSet.has(prompt);
      const score = exact ? 1 : Math.max(promptScore(ix, prompt, query), cosine(query, ix.textVector));
      if (score > 0) scored.push({ entry: ix.entry, score, exact });
    }
    scored.sort((a, b) => Number(b.exact) - Number(a.exact) || compareCandidates(a, b));
    return scored.slice(0, Math.floor(k)).map((s) => snapshot(s.entry));
  }

  async store(block: MoveBlock, prompt: string, creatorId: string): Promise<Result<StoreOutcome, LibError>> {
    const printed = printMoveBlock(block, this.#registry);
    if (!printed.ok) return err({ kind: 'invalid_block', reason: `${printed.error.path}: ${printed.error.reason}` });
    const key = canonicalKey(block);
    const existing = this.#byKey.get(key);

    // Build the next state without touching the current one, persist it, then commit (Req 14.10).
    let next: LibraryEntry;
    let created: boolean;
    if (existing) {
      created = false;
      next = existing.entry.prompts.includes(prompt)
        ? existing.entry
        : { ...existing.entry, prompts: [...existing.entry.prompts, prompt] };
    } else {
      created = true;
      next = {
        id: this.#newId(),
        canonicalKey: key,
        block: structuredClone(block),
        creatorId,
        createdAt: this.#now(),
        usageCount: 0,
        prompts: [prompt],
      };
    }
    if (next === existing?.entry) return ok({ entry: snapshot(next), created });

    const nextEntries = existing
      ? this.#entries.map((ix) => (ix === existing ? index(next) : ix))
      : [...this.#entries, index(next)];
    try {
      this.#persist(nextEntries.map((ix) => ix.entry));
    } catch (e) {
      return err({ kind: 'storage_failed', reason: e instanceof Error ? e.message : String(e) });
    }
    this.#commit(nextEntries);
    return ok({ entry: snapshot(next), created });
  }

  async incrementUsage(entryId: string): Promise<void> {
    const ix = this.#byId.get(entryId);
    if (!ix) return;
    ix.entry.usageCount += 1;
    try {
      this.#persist(this.#entries.map((x) => x.entry));
    } catch {
      // Memory stays authoritative for this session; the next successful write carries the count.
    }
  }

  async size(): Promise<number> {
    return this.#entries.length;
  }
  async all(): Promise<LibraryEntry[]> {
    return this.#entries.map((ix) => snapshot(ix.entry));
  }

  #commit(entries: Indexed[]): void {
    this.#entries = entries;
    this.#byKey = new Map(entries.map((ix) => [ix.entry.canonicalKey, ix]));
    this.#byId = new Map(entries.map((ix) => [ix.entry.id, ix]));
  }

  #persist(entries: readonly LibraryEntry[]): void {
    if (!this.#storage) return;
    const records: StoredRecord[] = entries.map((e) => {
      const printed = printMoveBlock(e.block, this.#registry);
      if (!printed.ok) throw new Error(`entry ${e.id} no longer prints: ${printed.error.reason}`);
      return { ...e, block: printed.value };
    });
    this.#storage.setItem(this.#key, JSON.stringify({ version: 1, entries: records }));
  }

  /** Loads persisted entries. Unreadable data or records that no longer parse are skipped. */
  #load(): void {
    if (!this.#storage) return;
    let raw: string | null;
    try {
      raw = this.#storage.getItem(this.#key);
    } catch {
      return;
    }
    if (raw === null) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const records = (data as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(records)) return;
    const loaded: Indexed[] = [];
    const seen = new Set<string>();
    for (const r of records as Partial<StoredRecord>[]) {
      if (
        typeof r?.id !== 'string' || typeof r.block !== 'string' || typeof r.creatorId !== 'string' ||
        typeof r.createdAt !== 'number' || !Number.isInteger(r.usageCount) || r.usageCount! < 0 ||
        !Array.isArray(r.prompts) || r.prompts.length === 0 || !r.prompts.every((p) => typeof p === 'string')
      ) continue;
      const parsed = parseMoveBlock(r.block, this.#registry);
      if (!parsed.ok) continue;
      const key = canonicalKey(parsed.value);
      if (seen.has(key)) continue;
      seen.add(key);
      loaded.push(index({
        id: r.id,
        canonicalKey: key,
        block: parsed.value,
        creatorId: r.creatorId,
        createdAt: r.createdAt,
        usageCount: r.usageCount!,
        prompts: [...new Set(r.prompts)],
      }));
    }
    this.#commit(loaded);
  }
}
