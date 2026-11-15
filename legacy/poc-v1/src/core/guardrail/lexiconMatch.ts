// Stage-1 lexicon matching for the Guardrail (design: "Guardrail > Stage 1, lexicon").
// Pure: text is normalized (NFKC, lowercase, simple leetspeak folding) and matched word by word
// against lexicon phrases, so terms never match inside longer words.
import type { DerogatoryCategory, LexiconEntry } from '../../content/lexicon';

const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
  '+': 't',
};

const HAS_LETTER = /\p{L}/u;
const LEET_SYMBOL = /[@$!|+]/u;
const EDGE_PUNCTUATION = /^[\s"'([{<.,;:?!]+|[\s"')\]}>.,;:?!]+$/gu;
const NON_ALNUM = /[^\p{L}\p{N}]/gu;

/**
 * Normalizes one whitespace-free token. Leetspeak digits are only folded when the token also
 * contains a letter, so plain numbers ("50 arrows") are left alone. Edge punctuation is dropped
 * before folding so a trailing "!" is not read as an "i".
 */
export function normalizeToken(token: string): string {
  const base = token.normalize('NFKC').toLowerCase().replace(EDGE_PUNCTUATION, '');
  // A token of only digits (e.g. "50") is a number, not leetspeak, so it keeps its digits.
  const shouldFold = HAS_LETTER.test(base) || LEET_SYMBOL.test(base);
  const folded = shouldFold ? [...base].map((ch) => LEET[ch] ?? ch).join('') : base;
  return folded.replace(NON_ALNUM, '');
}

/** Normalized words of `text`, in order, with empty tokens (pure punctuation) dropped. */
export function normalizeWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .split(/\s+/u)
    .map(normalizeToken)
    .filter((w) => w.length > 0);
}

export interface LexiconMatch {
  category: DerogatoryCategory;
  term: string;
  /** Index of the first and one past the last matched original token (whitespace-split). */
  startToken: number;
  endToken: number;
}

interface CompiledEntry {
  entry: LexiconEntry;
  words: string[];
}

const compileCache = new WeakMap<readonly LexiconEntry[], CompiledEntry[]>();

function compile(lexicon: readonly LexiconEntry[]): CompiledEntry[] {
  let compiled = compileCache.get(lexicon);
  if (!compiled) {
    compiled = lexicon
      .map((entry) => ({ entry, words: normalizeWords(entry.term) }))
      .filter((c) => c.words.length > 0);
    compileCache.set(lexicon, compiled);
  }
  return compiled;
}

function tokenize(text: string): string[] {
  return text
    .normalize('NFKC')
    .split(/\s+/u)
    .filter((t) => t.length > 0);
}

/** All lexicon phrase matches in `text`, ordered by position. Overlapping matches are all reported. */
export function findLexiconMatches(text: string, lexicon: readonly LexiconEntry[]): LexiconMatch[] {
  const tokens = tokenize(text);
  // Positions of non-empty normalized words, mapped back to their original token index.
  const words: string[] = [];
  const tokenIndex: number[] = [];
  tokens.forEach((t, i) => {
    const w = normalizeToken(t);
    if (w.length > 0) {
      words.push(w);
      tokenIndex.push(i);
    }
  });
  const matches: LexiconMatch[] = [];
  const compiled = compile(lexicon);
  for (let start = 0; start < words.length; start++) {
    for (const { entry, words: termWords } of compiled) {
      if (start + termWords.length > words.length) continue;
      if (termWords.every((tw, k) => words[start + k] === tw)) {
        matches.push({
          category: entry.category,
          term: entry.term,
          startToken: tokenIndex[start]!,
          endToken: tokenIndex[start + termWords.length - 1]! + 1,
        });
      }
    }
  }
  return matches;
}

/** Removes every matched phrase from `text` and collapses whitespace. May return an empty string. */
export function removeLexiconMatches(text: string, lexicon: readonly LexiconEntry[]): string {
  const tokens = tokenize(text);
  const drop = new Array<boolean>(tokens.length).fill(false);
  for (const m of findLexiconMatches(text, lexicon)) {
    for (let i = m.startToken; i < m.endToken; i++) drop[i] = true;
  }
  return tokens.filter((_, i) => !drop[i]).join(' ').trim();
}
