import { describe, expect, it } from 'vitest';
import { FALLBACK_MOVES } from '../../content/fallbacks';
import { applyParamAdjustments } from './adjust';
import { isOneSentence, validateGeneratedMeta } from './meta';
import { createDefaultRegistry } from './primitiveSchemas';

const registry = createDefaultRegistry();

describe('validateGeneratedMeta', () => {
  const ok = { displayName: 'Hair Clones', description: 'The puppet conjures clones.' };

  it('accepts names of 1 to 40 code points, a one-sentence description, and a short note', () => {
    expect(validateGeneratedMeta(ok).ok).toBe(true);
    expect(validateGeneratedMeta({ ...ok, displayName: '🏹'.repeat(40), note: 'n'.repeat(200) }).ok).toBe(true);
  });

  it('rejects empty or long names, long or multi-sentence descriptions, and long notes', () => {
    expect(validateGeneratedMeta({ ...ok, displayName: '' }).ok).toBe(false);
    expect(validateGeneratedMeta({ ...ok, displayName: 'x'.repeat(41) }).ok).toBe(false);
    expect(validateGeneratedMeta({ ...ok, description: `${'a'.repeat(150)}.` }).ok).toBe(false);
    expect(validateGeneratedMeta({ ...ok, description: 'One. Two.' }).ok).toBe(false);
    expect(validateGeneratedMeta({ ...ok, note: 'n'.repeat(201) }).ok).toBe(false);
  });

  it('isOneSentence', () => {
    expect(isOneSentence('Strikes hard!')).toBe(true);
    expect(isOneSentence('Wait, what?!')).toBe(true);
    expect(isOneSentence('No terminator')).toBe(false);
    expect(isOneSentence(' Leading space.')).toBe(false);
    expect(isOneSentence('...')).toBe(false);
    expect(isOneSentence('First! Second.')).toBe(false);
  });
});

describe('applyParamAdjustments', () => {
  const block = FALLBACK_MOVES.find((m) => m.primitives[0]!.primitive === 'projectile_volley')!;

  it('clamps and rounds numeric changes and leaves the input unchanged', () => {
    const before = structuredClone(block);
    const { block: out, rejected } = applyParamAdjustments(block, [
      { index: 0, param: 'count', value: 1000 },
      { index: 0, param: 'speed', value: -5 },
      { index: 0, param: 'intervalMs', value: 70.6 },
    ], registry);
    expect(rejected).toEqual([]);
    expect(out.primitives[0]!.params).toMatchObject({ count: 100, speed: 1, intervalMs: 71 });
    expect(out.primitives.map((p) => p.primitive)).toEqual(block.primitives.map((p) => p.primitive));
    expect(block).toEqual(before);
  });

  it('rejects changes that would alter structure or have the wrong type', () => {
    const { block: out, rejected } = applyParamAdjustments(block, [
      { index: 1, param: 'count', value: 5 },
      { index: 0, param: 'primitive', value: 'apply_impulse' },
      { index: 0, param: 'count', value: Number.NaN },
      { index: 0, param: 'projectileShape', value: 'banana' },
    ], registry);
    expect(rejected.map((r) => r.change)).toEqual([0, 1, 2, 3]);
    expect(out).toEqual(block);
  });
});
