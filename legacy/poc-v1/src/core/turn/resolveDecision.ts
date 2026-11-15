// Move resolution decision table (design: "Turn_Manager > Move resolution decision table").
//
// `resolveDecision` is a pure step function over the service outcomes gathered so far for one Turn.
// It returns either the next service call to make or a terminal action. The reducer calls it after
// every service result, so each row of the table is decided in exactly one place.
import type { MoveBlock } from '../moveblock/types';
import type { Category, FallbackReason, MoveSource, TurnInput } from './state';

/** Same shape as `MovePromptModeration` from src/ai/guardrail.ts. */
export type PromptModeration =
  | { kind: 'accepted'; prompt: string }
  | { kind: 'rewritten'; prompt: string; category: Category }
  | { kind: 'fallback'; reason: 'guardrail_rejected' | 'guardrail_unavailable'; category?: Category };

/** Move_Library `nearest` result; `failed` covers timeouts and errors (Req 14.9). */
export type LibraryLookup =
  | { kind: 'ok'; entry: { id: string; block: MoveBlock } | null; score: number }
  | { kind: 'failed' };

/** Parameter adjustment of a reused entry (Req 14.4). `changed` is false when no quantity differed. */
export type AdjustOutcome = { kind: 'ok'; block: MoveBlock; changed: boolean } | { kind: 'failed' };

export type GeneratorOutcome =
  | { kind: 'ok'; block: MoveBlock; note?: string }
  | { kind: 'failed'; failure: 'timeout' | 'error' | 'invalid_output' };

/** Guardrail verdict on a generated display name and description (Req 10.2, 10.7, 10.10). */
export type MetaModeration = { kind: 'acceptable' } | { kind: 'derogatory'; category: Category } | { kind: 'unavailable' };

/** Everything known about the Turn's resolution so far. */
export interface ResolutionTrace {
  input: TurnInput;
  moderation?: PromptModeration;
  library?: LibraryLookup;
  adjust?: AdjustOutcome;
  generator?: GeneratorOutcome;
  meta?: MetaModeration;
  /** Result of `validateWithClamp` (both passes) for the current candidate. */
  validation?: { valid: boolean };
  /** The 1 s / 4 s latency budget expired (Req 18.5). */
  budgetExpired?: boolean;
}

/** A non-fallback Move ready for validation. */
export interface Candidate {
  source: Exclude<MoveSource, 'fallback'>;
  block: MoveBlock;
  libraryEntryId?: string;
  promptUsed?: string;
  note?: string;
  /** Set when the Guardrail rewrote the prompt (Req 10.3, 10.6). */
  rewrite?: { category: Category };
}

export type ResolveAction =
  | { kind: 'moderate'; prompt: string }
  | { kind: 'lookup'; prompt: string }
  | { kind: 'adjust'; entry: { id: string; block: MoveBlock }; prompt: string }
  | { kind: 'generate'; prompt: string }
  | { kind: 'moderate_meta'; block: MoveBlock }
  | { kind: 'validate'; candidate: Candidate }
  | { kind: 'execute'; candidate: Candidate }
  /** A selected stored Move failed validation; the reducer reopens the window if time remains (Req 8.8). */
  | { kind: 'stored_invalid'; candidate: Candidate }
  | { kind: 'fallback'; reason: FallbackReason; category?: Category };

type Pending = Exclude<ResolveAction, { kind: 'execute' } | { kind: 'fallback' }>;

/** Validation step shared by every candidate (Req 11.1, 11.6, 8.4). */
function validateStep(trace: ResolutionTrace, candidate: Candidate): ResolveAction {
  if (trace.validation === undefined) return { kind: 'validate', candidate };
  if (trace.validation.valid) return { kind: 'execute', candidate };
  if (candidate.source === 'stored_selection') return { kind: 'stored_invalid', candidate };
  return { kind: 'fallback', reason: 'invalid_after_clamp' };
}

function decide(trace: ResolutionTrace, reuseThreshold: number): ResolveAction {
  const { input } = trace;
  if (input.kind === 'none') return { kind: 'fallback', reason: 'no_input' }; // Req 7.6

  if (input.kind === 'stored') {
    // Stored Moves were moderated when stored; never moderate or generate again (Req 8.4, 10.8).
    const { block, libraryEntryId, prompt } = input.selection;
    return validateStep(trace, { source: 'stored_selection', block, libraryEntryId, promptUsed: prompt });
  }

  const mod = trace.moderation;
  if (mod === undefined) return { kind: 'moderate', prompt: input.text };
  if (mod.kind === 'fallback') return { kind: 'fallback', reason: mod.reason, category: mod.category }; // Req 10.4, 10.5, 10.7
  const prompt = mod.prompt;
  const rewrite = mod.kind === 'rewritten' ? { category: mod.category } : undefined;

  const lib = trace.library;
  if (lib === undefined) return { kind: 'lookup', prompt };
  const best = lib.kind === 'ok' ? lib.entry : null;

  if (lib.kind === 'ok' && best !== null && lib.score >= reuseThreshold) {
    // Reuse without generation (Req 14.3); adjust quantities when they differ (Req 14.4).
    const adj = trace.adjust;
    if (adj === undefined) return { kind: 'adjust', entry: best, prompt };
    const candidate: Candidate =
      adj.kind === 'ok'
        ? { source: adj.changed ? 'library_adjusted' : 'library', block: adj.block, libraryEntryId: best.id, promptUsed: prompt, rewrite }
        : { source: 'library', block: best.block, libraryEntryId: best.id, promptUsed: prompt, rewrite };
    return validateStep(trace, candidate);
  }

  // Below threshold, or the lookup failed: generate exactly once (Req 9.1, 14.8, 14.9).
  const gen = trace.generator;
  if (gen === undefined) return { kind: 'generate', prompt };
  if (gen.kind === 'failed') {
    // Req 9.4, 9.8: best library entry, or a Fallback_Move when there is none.
    if (best === null) return { kind: 'fallback', reason: 'generator_timeout_empty_library' };
    return validateStep(trace, { source: 'library', block: best.block, libraryEntryId: best.id, promptUsed: prompt, rewrite });
  }

  const meta = trace.meta;
  if (meta === undefined) return { kind: 'moderate_meta', block: gen.block };
  if (meta.kind === 'derogatory') return { kind: 'fallback', reason: 'guardrail_rejected', category: meta.category }; // Req 10.10
  if (meta.kind === 'unavailable') return { kind: 'fallback', reason: 'guardrail_unavailable' }; // Req 10.7
  return validateStep(trace, { source: 'generated', block: gen.block, promptUsed: prompt, note: gen.note, rewrite });
}

/**
 * Next step for a Turn's Move resolution. Terminal actions are `execute` and `fallback`; anything else
 * names the service call to make next. When the latency budget has expired, any Move that has not yet
 * passed validation is discarded for a Fallback_Move with reason `budget_expired` (Req 18.5).
 */
export function resolveDecision(trace: ResolutionTrace, reuseThreshold: number): ResolveAction {
  const action = decide(trace, reuseThreshold);
  if (trace.budgetExpired && isPending(action)) return { kind: 'fallback', reason: 'budget_expired' };
  return action;
}

function isPending(a: ResolveAction): a is Pending {
  return a.kind !== 'execute' && a.kind !== 'fallback';
}
