import { describe, expect, it } from 'vitest';
import { highestMagnitudeTrait, orderFallbacks, selectFallback } from './orderFallbacks';

const fb = (description: string) => ({ description });
const trait = (name: string, magnitude: number) => ({ name, description: name, magnitude });

describe('highestMagnitudeTrait', () => {
  it('picks the highest magnitude, first listed on ties', () => {
    expect(highestMagnitudeTrait([trait('A', 5), trait('B', 9), trait('C', 9)])?.name).toBe('B');
    expect(highestMagnitudeTrait([])).toBeUndefined();
  });
});

describe('orderFallbacks', () => {
  const set = [fb('A quick staff blow.'), fb('Arrows rain from above, a volley of arrows.'), fb('A mace swing.'), fb('One arrow.')];

  it('sorts by similarity to the highest-magnitude Trait name, descending', () => {
    const order = orderFallbacks(set, [trait('Mace Strength', 3), trait('Master Archer Arrows', 9)]);
    expect(order[0]!.index).toBe(1);
    expect(order.map((r) => r.score)).toEqual([...order.map((r) => r.score)].sort((a, b) => b - a));
  });

  it('breaks score ties by set order', () => {
    const order = orderFallbacks(set, [trait('Lightning', 9)]);
    expect(order.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(order.every((r) => r.score === 0)).toBe(true);
  });

  it('uses the first-listed Trait when magnitudes tie', () => {
    const order = orderFallbacks(set, [trait('Mace', 7), trait('Arrow', 7)]);
    expect(order[0]!.index).toBe(2);
  });

  it('keeps set order with no Traits', () => {
    expect(orderFallbacks(set, []).map((r) => r.index)).toEqual([0, 1, 2, 3]);
  });
});

describe('selectFallback', () => {
  const order = [{ index: 2, score: 1 }, { index: 0, score: 0.5 }, { index: 1, score: 0 }];

  it('takes the first valid candidate in order', () => {
    expect(selectFallback(order, (i) => i !== 2)).toBe(0);
    expect(selectFallback(order, () => true)).toBe(2);
  });

  it('returns null when none is valid', () => {
    expect(selectFallback(order, () => false)).toBeNull();
  });
});
