import { describe, expect, it } from 'vitest';
import { pickBest } from './pickBest';

const e = (id: string, usageCount: number, createdAt: number) => ({ id, usageCount, createdAt });

describe('pickBest', () => {
  it('returns no entry and score 0 for an empty list', () => {
    expect(pickBest([])).toEqual({ entry: null, score: 0 });
  });

  it('picks the highest score', () => {
    const r = pickBest([{ entry: e('a', 9, 0), score: 0.4 }, { entry: e('b', 0, 5), score: 0.9 }]);
    expect(r.entry?.id).toBe('b');
    expect(r.score).toBe(0.9);
  });

  it('breaks score ties by usage count, then earliest creation time', () => {
    expect(pickBest([{ entry: e('a', 1, 0), score: 0.5 }, { entry: e('b', 3, 9), score: 0.5 }]).entry?.id).toBe('b');
    expect(pickBest([{ entry: e('a', 2, 9), score: 0.5 }, { entry: e('b', 2, 1), score: 0.5 }]).entry?.id).toBe('b');
  });

  it('clamps scores to [0, 1]', () => {
    expect(pickBest([{ entry: e('a', 0, 0), score: 1.0000001 }]).score).toBe(1);
    expect(pickBest([{ entry: e('a', 0, 0), score: Number.NaN }]).score).toBe(0);
  });
});
