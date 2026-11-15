import { describe, expect, it } from 'vitest';
import { findNumbers, firstNumber } from './numbers';

describe('findNumbers', () => {
  it.each([
    ['fire 50 arrows', 50],
    ['a volley of a hundred arrows', 100],
    ['one hundred and five', 105],
    ['twenty-five clones', 25],
    ['three hundred thousand', 300_000],
    ['a dozen spears', 12],
    ['1,000 stones', 1000],
    ['2 hundred', 200],
    ['eight', 8],
  ])('%s -> %d', (text, value) => {
    expect(firstNumber(text)).toBe(value);
  });

  it('returns every number in text order with offsets', () => {
    const text = 'summon 2 boulders and fire ten arrows';
    const found = findNumbers(text);
    expect(found.map((n) => n.value)).toEqual([2, 10]);
    expect(text.slice(found[1]!.start, found[1]!.end)).toBe('ten');
  });

  it('ignores number words inside other words and plain articles', () => {
    expect(findNumbers('someone threw a rock')).toEqual([]);
    expect(firstNumber('no numbers here')).toBeUndefined();
  });
});
