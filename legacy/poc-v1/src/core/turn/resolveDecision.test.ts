import { describe, expect, it } from 'vitest';
import { FALLBACK_MOVES } from '../../content/fallbacks';
import { resolveDecision, type ResolutionTrace } from './resolveDecision';

const block = FALLBACK_MOVES[0]!;
const other = FALLBACK_MOVES[1]!;
const entry = { id: 'e1', block };
const T = 0.85;
const prompt = (text = 'fire arrows'): ResolutionTrace => ({ input: { kind: 'prompt', text } });
const accepted = { kind: 'accepted', prompt: 'fire arrows' } as const;
const hit = { kind: 'ok', entry, score: 0.9 } as const;
const miss = { kind: 'ok', entry, score: 0.4 } as const;
const empty = { kind: 'ok', entry: null, score: 0 } as const;

describe('resolveDecision', () => {
  it('falls back with no_input when nothing was entered', () => {
    expect(resolveDecision({ input: { kind: 'none' } }, T)).toEqual({ kind: 'fallback', reason: 'no_input' });
  });

  it('validates a stored selection without moderation or generation, and flags it when invalid', () => {
    const t: ResolutionTrace = { input: { kind: 'stored', selection: { block, libraryEntryId: 'e1' } } };
    expect(resolveDecision(t, T)).toMatchObject({ kind: 'validate', candidate: { source: 'stored_selection', libraryEntryId: 'e1' } });
    expect(resolveDecision({ ...t, validation: { valid: true } }, T).kind).toBe('execute');
    expect(resolveDecision({ ...t, validation: { valid: false } }, T).kind).toBe('stored_invalid');
  });

  it('moderates first and maps moderation fallbacks to their reasons', () => {
    expect(resolveDecision(prompt(), T)).toEqual({ kind: 'moderate', prompt: 'fire arrows' });
    expect(resolveDecision({ ...prompt(), moderation: { kind: 'fallback', reason: 'guardrail_rejected', category: 'slurs' } }, T)).toEqual({
      kind: 'fallback',
      reason: 'guardrail_rejected',
      category: 'slurs',
    });
    expect(resolveDecision({ ...prompt(), moderation: { kind: 'fallback', reason: 'guardrail_unavailable' } }, T)).toMatchObject({
      reason: 'guardrail_unavailable',
    });
  });

  it('continues with the rewritten prompt', () => {
    const t: ResolutionTrace = { ...prompt('bad'), moderation: { kind: 'rewritten', prompt: 'clean', category: 'harassment' } };
    expect(resolveDecision(t, T)).toEqual({ kind: 'lookup', prompt: 'clean' });
    const done = resolveDecision({ ...t, library: miss, generator: { kind: 'ok', block }, meta: { kind: 'acceptable' } }, T);
    expect(done).toMatchObject({ kind: 'validate', candidate: { source: 'generated', promptUsed: 'clean', rewrite: { category: 'harassment' } } });
  });

  it('reuses a library entry at or above the threshold without generating', () => {
    const t: ResolutionTrace = { ...prompt(), moderation: accepted, library: hit };
    expect(resolveDecision(t, T)).toMatchObject({ kind: 'adjust', entry });
    expect(resolveDecision({ ...t, adjust: { kind: 'ok', block: other, changed: true } }, T)).toMatchObject({
      kind: 'validate',
      candidate: { source: 'library_adjusted', block: other, libraryEntryId: 'e1' },
    });
    expect(resolveDecision({ ...t, adjust: { kind: 'failed' } }, T)).toMatchObject({ candidate: { source: 'library', block } });
  });

  it('generates when the score is below the threshold or the lookup failed', () => {
    expect(resolveDecision({ ...prompt(), moderation: accepted, library: miss }, T).kind).toBe('generate');
    expect(resolveDecision({ ...prompt(), moderation: accepted, library: { kind: 'failed' } }, T).kind).toBe('generate');
  });

  it('uses the best library entry when generation fails, or falls back when the library is empty', () => {
    const failed = { kind: 'failed', failure: 'timeout' } as const;
    expect(resolveDecision({ ...prompt(), moderation: accepted, library: miss, generator: failed }, T)).toMatchObject({
      kind: 'validate',
      candidate: { source: 'library', libraryEntryId: 'e1' },
    });
    expect(resolveDecision({ ...prompt(), moderation: accepted, library: empty, generator: failed }, T)).toEqual({
      kind: 'fallback',
      reason: 'generator_timeout_empty_library',
    });
  });

  it('moderates generated metadata and falls back on rejection or unavailability', () => {
    const t: ResolutionTrace = { ...prompt(), moderation: accepted, library: empty, generator: { kind: 'ok', block, note: 'n' } };
    expect(resolveDecision(t, T).kind).toBe('moderate_meta');
    expect(resolveDecision({ ...t, meta: { kind: 'derogatory', category: 'graphic_gore' } }, T)).toMatchObject({
      reason: 'guardrail_rejected',
    });
    expect(resolveDecision({ ...t, meta: { kind: 'unavailable' } }, T)).toMatchObject({ reason: 'guardrail_unavailable' });
    expect(resolveDecision({ ...t, meta: { kind: 'acceptable' } }, T)).toMatchObject({ candidate: { note: 'n' } });
  });

  it('falls back with invalid_after_clamp when the candidate is invalid', () => {
    const t: ResolutionTrace = { ...prompt(), moderation: accepted, library: hit, adjust: { kind: 'failed' }, validation: { valid: false } };
    expect(resolveDecision(t, T)).toEqual({ kind: 'fallback', reason: 'invalid_after_clamp' });
  });

  it('discards unvalidated work when the budget expired, but keeps a validated Move', () => {
    const t: ResolutionTrace = { ...prompt(), moderation: accepted, library: miss, budgetExpired: true };
    expect(resolveDecision(t, T)).toEqual({ kind: 'fallback', reason: 'budget_expired' });
    const valid: ResolutionTrace = { ...prompt(), moderation: accepted, library: hit, adjust: { kind: 'failed' }, validation: { valid: true }, budgetExpired: true };
    expect(resolveDecision(valid, T).kind).toBe('execute');
  });
});
