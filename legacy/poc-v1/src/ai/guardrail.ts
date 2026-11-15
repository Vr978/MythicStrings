// Guardrail adapter (design: "Guardrail"). The PoC runs only stage 1, the local lexicon filter;
// a classifier-backed Guardrail can implement the same interface later.
import { BLOCKED_LEXICON, type DerogatoryCategory, type LexiconEntry } from '../content/lexicon';
import { findLexiconMatches, removeLexiconMatches } from '../core/guardrail/lexiconMatch';
import { pickCategory } from '../core/guardrail/pickCategory';
import { err, ok, type Result } from '../core/moveblock/types';

export type TextKind =
  | 'scenario_prompt'
  | 'move_prompt'
  | 'rewritten_prompt'
  | 'display_name'
  | 'description'
  | 'scenario_text';

export type Verdict = { kind: 'acceptable' } | { kind: 'derogatory'; category: DerogatoryCategory };

export type GuardrailError = 'timeout' | 'unavailable';

export interface RewriteContext {
  /** Category from the rejected classification. */
  category: DerogatoryCategory;
  /** Target Puppet_Character name, kept by the rewrite (Req 10.3). */
  targetName?: string;
}

export interface Guardrail {
  classify(text: string, kind: TextKind): Promise<Result<Verdict, GuardrailError>>;
  rewrite(text: string, ctx: RewriteContext): Promise<Result<string, GuardrailError>>;
}

/** Classification budget for Move text (Req 10.1, 10.2, 10.7). */
export const GUARDRAIL_TIMEOUT_MS = 200;
/** Rewrite budget after a rejection (Req 10.3, 10.5). */
export const REWRITE_TIMEOUT_MS = 500;
/** Classification budget for Scenario_Prompts (Req 3.2). */
export const SCENARIO_PROMPT_TIMEOUT_MS = 2000;

export interface ModerationLogEntry {
  category: DerogatoryCategory;
  /** Milliseconds since the Unix epoch. */
  timestamp: number;
  text: string;
  textKind: TextKind;
}

/** Append-only, in-memory moderation log (Req 10.9). */
export class ModerationLog {
  private readonly items: ModerationLogEntry[] = [];

  append(entry: ModerationLogEntry): void {
    this.items.push({ ...entry });
  }

  entries(): readonly ModerationLogEntry[] {
    return this.items.map((e) => ({ ...e }));
  }

  get size(): number {
    return this.items.length;
  }
}

export interface LexiconGuardrailOptions {
  lexicon?: readonly LexiconEntry[];
  log?: ModerationLog;
  now?: () => number;
}

/** Stage-1 Guardrail: normalized lexicon matching, deterministic and synchronous under the hood. */
export class LexiconGuardrail implements Guardrail {
  readonly log: ModerationLog;
  private readonly lexicon: readonly LexiconEntry[];
  private readonly now: () => number;

  constructor(options: LexiconGuardrailOptions = {}) {
    this.lexicon = options.lexicon ?? BLOCKED_LEXICON;
    this.log = options.log ?? new ModerationLog();
    this.now = options.now ?? Date.now;
  }

  async classify(text: string, kind: TextKind): Promise<Result<Verdict, GuardrailError>> {
    const category = pickCategory(findLexiconMatches(text, this.lexicon).map((m) => m.category));
    if (category === null) return ok({ kind: 'acceptable' });
    this.log.append({ category, timestamp: this.now(), text, textKind: kind });
    return ok({ kind: 'derogatory', category });
  }

  /**
   * Removes the blocked phrases and returns what is left, which may be empty. The rewrite does not
   * classify itself: the caller classifies the result as `rewritten_prompt` before generation (Req 10.12).
   */
  async rewrite(text: string, _ctx: RewriteContext): Promise<Result<string, GuardrailError>> {
    return ok(removeLexiconMatches(text, this.lexicon));
  }
}

/**
 * Races a Guardrail call against a deadline. Resolves to `err('timeout')` when the deadline passes
 * first and to `err('unavailable')` when the call throws or rejects, so callers can fail closed (Req 10.7).
 */
export async function withDeadline<T>(
  promise: Promise<Result<T, GuardrailError>>,
  ms: number,
): Promise<Result<T, GuardrailError>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<T, GuardrailError>>((resolve) => {
    timer = setTimeout(() => resolve(err('timeout')), ms);
  });
  const guarded = promise.then(
    (r) => r,
    () => err('unavailable' as const),
  );
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Outcome of moderating a Move_Prompt, including the single rewrite attempt (Req 10.1, 10.3 to 10.5, 10.7). */
export type MovePromptModeration =
  | { kind: 'accepted'; prompt: string }
  | { kind: 'rewritten'; prompt: string; category: DerogatoryCategory }
  | { kind: 'fallback'; reason: 'guardrail_rejected' | 'guardrail_unavailable'; category?: DerogatoryCategory };

/**
 * Classifies a Move_Prompt; on rejection makes exactly one rewrite attempt and classifies the rewrite
 * as `rewritten_prompt` before anything is generated (Req 10.12). Timeouts and errors fail closed.
 */
export async function moderateMovePrompt(
  guardrail: Guardrail,
  prompt: string,
  ctx: Omit<RewriteContext, 'category'> = {},
  timeouts: { classifyMs?: number; rewriteMs?: number } = {},
): Promise<MovePromptModeration> {
  const classifyMs = timeouts.classifyMs ?? GUARDRAIL_TIMEOUT_MS;
  const rewriteMs = timeouts.rewriteMs ?? REWRITE_TIMEOUT_MS;

  const first = await withDeadline(guardrail.classify(prompt, 'move_prompt'), classifyMs);
  if (!first.ok) return { kind: 'fallback', reason: 'guardrail_unavailable' };
  if (first.value.kind === 'acceptable') return { kind: 'accepted', prompt };
  const category = first.value.category;

  const rewritten = await withDeadline(guardrail.rewrite(prompt, { ...ctx, category }), rewriteMs);
  if (!rewritten.ok || rewritten.value.trim().length === 0) {
    return { kind: 'fallback', reason: 'guardrail_rejected', category };
  }
  const second = await withDeadline(guardrail.classify(rewritten.value, 'rewritten_prompt'), classifyMs);
  if (!second.ok) return { kind: 'fallback', reason: 'guardrail_unavailable', category };
  if (second.value.kind === 'derogatory') {
    return { kind: 'fallback', reason: 'guardrail_rejected', category: second.value.category };
  }
  return { kind: 'rewritten', prompt: rewritten.value, category };
}
