import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isNumberToken, stem, textSimilarity, tokenize } from './similarity';

describe('tokenize', () => {
  it('lowercases, strips punctuation and stopwords, keeps numbers', () => {
    expect(tokenize('Fire 50 ARROWS at the sky!')).toEqual(['fire', '50', 'arrows', 'sky']);
    expect(tokenize("Arjun's 2.5-metre arrow")).toEqual(['arjuns', '2.5', 'metre', 'arrow']);
    expect(tokenize('  ,.!  ')).toEqual([]);
  });

  it('recognizes number tokens and stems plurals', () => {
    expect(isNumberToken('50')).toBe(true);
    expect(isNumberToken('fifty')).toBe(true);
    expect(isNumberToken('fire')).toBe(false);
    expect(stem('arrows')).toBe('arrow');
    expect(stem('enemies')).toBe('enemy');
    expect(stem('glass')).toBe('glass');
    expect(stem('gas')).toBe('gas');
  });
});

describe('textSimilarity', () => {
  it('scores identical text 1 and disjoint text 0', () => {
    expect(textSimilarity('fire arrows', 'fire arrows')).toBe(1);
    expect(textSimilarity('fire arrows', 'drop boulder')).toBe(0);
    expect(textSimilarity('', 'fire')).toBe(0);
  });

  it('treats quantity-only differences as equal when numbers are ignored', () => {
    expect(textSimilarity('fire 50 arrows', 'fire 10 arrows', { ignoreNumbers: true })).toBeGreaterThanOrEqual(0.85);
    expect(textSimilarity('Fire fifty arrows', 'fire 10 arrow', { ignoreNumbers: true })).toBe(1);
    expect(textSimilarity('fire 50 arrows', 'fire 10 arrows')).toBeLessThan(1);
  });

  it('is symmetric and stays in [0, 1]', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const s = textSimilarity(a, b);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        expect(s).toBeCloseTo(textSimilarity(b, a), 12);
      }),
    );
  });
});
