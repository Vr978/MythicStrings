// Bag-of-words text similarity (design: Move_Library, Recommendation_Engine, orderFallbacks).
// Pure and dependency-free, so core logic and the local AI adapters share one implementation.
// This stands in for the embedding model of the PostgreSQL design; scores are cosine values in [0, 1].

/** Short function words that carry no meaning for Move matching. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
  'into', 'onto', 'up', 'down', 'out', 'over', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its',
  'this', 'that', 'these', 'those', 'as', 'so', 'then', 'than', 'my', 'his', 'her', 'their', 'our',
  'your', 'he', 'she', 'they', 'we', 'you', 'i', 'me', 'him', 'them', 'us', 'all', 'some', 'very',
  'just', 'do', 'does', 'did',
]);

/** Spelled-out quantities that count as number tokens (so "fifty arrows" matches "10 arrows"). */
const NUMBER_WORDS: ReadonlySet<string> = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred',
  'hundreds', 'thousand', 'thousands', 'dozen', 'dozens', 'single', 'double', 'triple',
]);

/** Decimal numbers stay whole ("2.5"); otherwise runs of letters, marks, digits, and apostrophes. */
const TOKEN_RE = /\d+(?:\.\d+)?|[\p{L}\p{M}\p{N}']+/gu;

/** True for digit tokens ("50", "2.5") and spelled-out quantities ("fifty"). */
export function isNumberToken(token: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(token) || NUMBER_WORDS.has(token);
}

/**
 * Light plural stemming so "arrows" matches "arrow": "-ies" becomes "-y", a final "s" is dropped
 * unless the word ends in "ss", "us", or "is", or is 3 characters or shorter. Number tokens are unchanged.
 */
export function stem(token: string): string {
  if (isNumberToken(token) || token.length <= 3) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('s') && !/(?:ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

/**
 * Lowercases, strips punctuation (apostrophes are removed inside words, so "Arjun's" becomes
 * "arjuns"), drops stopwords, and keeps number tokens. Tokens are not stemmed.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().normalize('NFKC').matchAll(TOKEN_RE)) {
    const t = m[0].replaceAll("'", '');
    if (t.length > 0 && !STOPWORDS.has(t)) out.push(t);
  }
  return out;
}

export interface VectorOptions {
  /** Drop number tokens, so prompts that differ only in quantities compare as equal. Default false. */
  ignoreNumbers?: boolean;
  /** Apply `stem` to each token. Default true. */
  stem?: boolean;
}

/** Sparse term-frequency vector. */
export type TermVector = ReadonlyMap<string, number>;

/** Term-frequency vector of `text` after tokenizing (and by default stemming). */
export function termVector(text: string, opts: VectorOptions = {}): TermVector {
  const v = new Map<string, number>();
  const doStem = opts.stem ?? true;
  for (const raw of tokenize(text)) {
    if (opts.ignoreNumbers && isNumberToken(raw)) continue;
    const t = doStem ? stem(raw) : raw;
    v.set(t, (v.get(t) ?? 0) + 1);
  }
  return v;
}

/** Cosine similarity of two term vectors, in [0, 1]. Either vector empty gives 0. */
export function cosine(a: TermVector, b: TermVector): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) dot += w * (large.get(t) ?? 0);
  if (dot === 0) return 0;
  let na = 0;
  let nb = 0;
  for (const w of a.values()) na += w * w;
  for (const w of b.values()) nb += w * w;
  const s = dot / Math.sqrt(na * nb);
  // Rounding can push identical vectors a hair past 1.
  return Math.min(1, Math.max(0, s));
}

/** Bag-of-words cosine similarity of two texts, in [0, 1]. */
export function textSimilarity(a: string, b: string, opts: VectorOptions = {}): number {
  return cosine(termVector(a, opts), termVector(b, opts));
}
