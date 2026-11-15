import { describe, expect, it } from 'vitest';
import { traitBalanceOk, validateTraitSet } from './traits';
import type { Trait } from './types';

const t = (name: string, magnitude = 5, description = 'A trait.'): Trait => ({ name, description, magnitude });

describe('validateTraitSet', () => {
  it('accepts 3 to 6 well-formed Traits', () => {
    expect(validateTraitSet([t('A'), t('B'), t('C')]).ok).toBe(true);
    expect(validateTraitSet([t('A'), t('B'), t('C'), t('D'), t('E'), t('F')]).ok).toBe(true);
  });

  it('rejects too few or too many Traits', () => {
    expect(validateTraitSet([t('A'), t('B')])).toMatchObject({ ok: false, error: { path: 'traits' } });
    const seven = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => t(n));
    expect(validateTraitSet(seven)).toMatchObject({ ok: false, error: { path: 'traits' } });
  });

  it('checks name and description lengths in code points', () => {
    expect(validateTraitSet([t(''), t('B'), t('C')])).toMatchObject({ ok: false, error: { path: 'traits[0].name' } });
    expect(validateTraitSet([t('🏹'.repeat(40)), t('B'), t('C')]).ok).toBe(true);
    expect(validateTraitSet([t('x'.repeat(41)), t('B'), t('C')])).toMatchObject({
      ok: false,
      error: { path: 'traits[0].name' },
    });
    expect(validateTraitSet([t('A', 5, 'd'.repeat(200)), t('B'), t('C')]).ok).toBe(true);
    expect(validateTraitSet([t('A'), t('B', 5, 'd'.repeat(201)), t('C')])).toMatchObject({
      ok: false,
      error: { path: 'traits[1].description' },
    });
  });

  it('requires integer magnitudes from 1 to 10', () => {
    for (const bad of [0, 11, 5.5, Number.NaN]) {
      expect(validateTraitSet([t('A'), t('B'), t('C', bad)])).toMatchObject({
        ok: false,
        error: { path: 'traits[2].magnitude' },
      });
    }
    expect(validateTraitSet([t('A', 1), t('B', 10), t('C')]).ok).toBe(true);
  });

  it('rejects names that collide ignoring case', () => {
    expect(validateTraitSet([t('Focus'), t('B'), t('fOCUS')])).toMatchObject({
      ok: false,
      error: { path: 'traits[2].name' },
    });
  });
});

describe('traitBalanceOk', () => {
  const chars = (...sums: number[][]) => ({ characters: sums.map((ms) => ({ traits: ms.map((m, i) => t(`T${i}`, m)) })) });

  it('allows a spread of exactly 10 and rejects 11', () => {
    expect(traitBalanceOk(chars([10, 10, 10], [10, 5, 5]))).toBe(true); // 30 vs 20
    expect(traitBalanceOk(chars([10, 10, 10], [9, 5, 5]))).toBe(false); // 30 vs 19
  });

  it('compares the extremes across all characters', () => {
    expect(traitBalanceOk(chars([5, 5, 5], [6, 6, 6], [3, 3, 3]))).toBe(true); // 15, 18, 9: spread 9
    expect(traitBalanceOk(chars([5, 5, 5], [6, 6, 6], [1, 1, 3]))).toBe(false); // 15, 18, 5: spread 13
  });
});
