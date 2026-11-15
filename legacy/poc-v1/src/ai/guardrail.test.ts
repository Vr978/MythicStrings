import { describe, expect, it } from 'vitest';
import type { LexiconEntry } from '../content/lexicon';
import { err, ok } from '../core/moveblock/types';
import {
  LexiconGuardrail,
  moderateMovePrompt,
  withDeadline,
  type Guardrail,
  type GuardrailError,
} from './guardrail';

describe('LexiconGuardrail.classify', () => {
  it('accepts clean mythological combat text without logging', async () => {
    const g = new LexiconGuardrail();
    expect(await g.classify('fire a volley of 50 arrows at Duryodhan', 'move_prompt')).toEqual(
      ok({ kind: 'acceptable' }),
    );
    expect(g.log.size).toBe(0);
  });

  it('rejects with one category and logs category, timestamp, text, and kind', async () => {
    const g = new LexiconGuardrail({ now: () => 1234 });
    const text = 'strike the stupid nitwit';
    expect(await g.classify(text, 'display_name')).toEqual(ok({ kind: 'derogatory', category: 'slurs' }));
    expect(g.log.entries()).toEqual([{ category: 'slurs', timestamp: 1234, text, textKind: 'display_name' }]);
  });

  it('classifies within the 200 ms budget', async () => {
    const g = new LexiconGuardrail();
    const long = 'arrows '.repeat(500) + 'idiot';
    const start = performance.now();
    const r = await withDeadline(g.classify(long, 'move_prompt'), 200);
    expect(performance.now() - start).toBeLessThan(200);
    expect(r).toEqual(ok({ kind: 'derogatory', category: 'harassment' }));
  });
});

describe('withDeadline', () => {
  it('returns timeout when the call is too slow and unavailable when it rejects', async () => {
    const never = new Promise<never>(() => {});
    expect(await withDeadline(never, 10)).toEqual(err('timeout'));
    expect(await withDeadline(Promise.reject(new Error('down')), 10)).toEqual(err('unavailable'));
    expect(await withDeadline(Promise.resolve(ok(1)), 10)).toEqual(ok(1));
  });
});

describe('moderateMovePrompt', () => {
  it('accepts a clean prompt unchanged', async () => {
    const r = await moderateMovePrompt(new LexiconGuardrail(), 'make clones from strands of hair');
    expect(r).toEqual({ kind: 'accepted', prompt: 'make clones from strands of hair' });
  });

  it('rewrites once, re-classifies as rewritten_prompt, and logs only the original rejection', async () => {
    const g = new LexiconGuardrail({ now: () => 1 });
    const r = await moderateMovePrompt(g, 'smash the stupid Duryodhan with a mace');
    expect(r).toEqual({ kind: 'rewritten', prompt: 'smash the Duryodhan with a mace', category: 'harassment' });
    expect(g.log.entries().map((e) => e.textKind)).toEqual(['move_prompt']);
  });

  it('falls back when the rewrite is empty', async () => {
    const r = await moderateMovePrompt(new LexiconGuardrail(), 'you are worthless');
    expect(r).toEqual({ kind: 'fallback', reason: 'guardrail_rejected', category: 'harassment' });
  });

  it('falls back without a second rewrite when the rewrite is still derogatory', async () => {
    // A lexicon term that only appears once removal joins two halves is unrealistic, so use a stub
    // rewriter that returns derogatory text and count its calls.
    const lexicon: LexiconEntry[] = [{ term: 'lewd', category: 'sexual_content', placeholder: true }];
    const real = new LexiconGuardrail({ lexicon });
    let rewrites = 0;
    const g: Guardrail = {
      classify: (t, k) => real.classify(t, k),
      rewrite: async () => {
        rewrites++;
        return ok('still lewd');
      },
    };
    const r = await moderateMovePrompt(g, 'a lewd strike');
    expect(r).toEqual({ kind: 'fallback', reason: 'guardrail_rejected', category: 'sexual_content' });
    expect(rewrites).toBe(1);
    expect(real.log.entries().map((e) => e.textKind)).toEqual(['move_prompt', 'rewritten_prompt']);
  });

  it('fails closed when the Guardrail times out or is unavailable', async () => {
    const slow: Guardrail = {
      classify: () => new Promise(() => {}),
      rewrite: () => new Promise(() => {}),
    };
    const down: Guardrail = {
      classify: async () => err<GuardrailError>('unavailable'),
      rewrite: async () => err<GuardrailError>('unavailable'),
    };
    expect(await moderateMovePrompt(slow, 'arrows', {}, { classifyMs: 10 })).toEqual({
      kind: 'fallback',
      reason: 'guardrail_unavailable',
    });
    expect(await moderateMovePrompt(down, 'arrows')).toEqual({ kind: 'fallback', reason: 'guardrail_unavailable' });
  });
});
