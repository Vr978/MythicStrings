import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BLOCKED_LEXICON, DEROGATORY_CATEGORIES } from '../../content/lexicon';
import { findLexiconMatches, normalizeToken, removeLexiconMatches } from './lexiconMatch';
import { CATEGORY_PRIORITY, pickCategory } from './pickCategory';

describe('pickCategory', () => {
  it('returns the highest-priority category present', () => {
    expect(pickCategory(['graphic_gore', 'harassment'])).toBe('harassment');
    expect(pickCategory(['hate_speech', 'slurs', 'unknown_label'])).toBe('slurs');
    expect(pickCategory(['sexual_content', 'demeaning_religious_cultural'])).toBe('sexual_content');
  });

  it('returns null when no known category is present', () => {
    expect(pickCategory([])).toBeNull();
    expect(pickCategory(['violence', 'other'])).toBeNull();
  });

  it('priority covers all six categories exactly once', () => {
    expect([...CATEGORY_PRIORITY].sort()).toEqual([...DEROGATORY_CATEGORIES].sort());
  });

  // Property 40: Exactly one rejection category
  // **Validates: Requirements 10.1**
  it('Property 40: returns exactly one highest-priority category regardless of order', () => {
    const label = fc.oneof(fc.constantFrom(...DEROGATORY_CATEGORIES), fc.string({ maxLength: 12 }));
    fc.assert(
      fc.property(
        fc.constantFrom(...DEROGATORY_CATEGORIES),
        fc.array(label, { maxLength: 8 }),
        fc.integer(),
        (known, others, seed) => {
          const labels = [known, ...others];
          const result = pickCategory(labels);
          expect(DEROGATORY_CATEGORIES).toContain(result);
          const expected = CATEGORY_PRIORITY.find((c) => labels.includes(c));
          expect(result).toBe(expected);
          const shuffled = [...labels].sort((a, b) => ((a.length * 31 + seed) % 7) - ((b.length * 31 + seed) % 7));
          expect(pickCategory(shuffled)).toBe(result);
        },
      ),
    );
  });
});

describe('lexicon matching', () => {
  it('normalizes NFKC, case, leetspeak, and edge punctuation', () => {
    expect(normalizeToken('ＳＴＵＰＩＤ')).toBe('stupid');
    expect(normalizeToken('5tup1d!')).toBe('stupid');
    expect(normalizeToken('1d!0t')).toBe('idiot');
    expect(normalizeToken('$tupid,')).toBe('stupid');
    expect(normalizeToken('50')).toBe('50');
  });

  it('matches single words and phrases but not substrings of longer words', () => {
    expect(findLexiconMatches('Fire arrows, you STUP1D demon', BLOCKED_LEXICON).map((m) => m.category)).toEqual([
      'harassment',
    ]);
    expect(findLexiconMatches('I will spill   guts', BLOCKED_LEXICON).map((m) => m.category)).toEqual([
      'graphic_gore',
    ]);
    expect(findLexiconMatches('stupidly brave idiotic charge', BLOCKED_LEXICON)).toEqual([]);
    expect(findLexiconMatches('fire a volley of 50 arrows at Duryodhan', BLOCKED_LEXICON)).toEqual([]);
  });

  it('has at least one typeable demo term per category that the matcher detects', () => {
    for (const category of DEROGATORY_CATEGORIES) {
      const demo = BLOCKED_LEXICON.find((e) => e.category === category && !e.term.startsWith('placeholder'));
      expect(demo).toBeDefined();
      expect(findLexiconMatches(`attack, ${demo!.term}!`, BLOCKED_LEXICON).map((m) => m.category)).toContain(category);
    }
  });

  it('removes matched phrases and keeps the rest of the text', () => {
    expect(removeLexiconMatches('fire 50 arrows at the stupid Duryodhan', BLOCKED_LEXICON)).toBe(
      'fire 50 arrows at the Duryodhan',
    );
    expect(removeLexiconMatches('you are worthless', BLOCKED_LEXICON)).toBe('');
  });
});
