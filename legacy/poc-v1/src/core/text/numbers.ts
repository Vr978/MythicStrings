// Number extraction from free text for the keyword Move_Generator (Req 9.1, 14.4).
// Pure: recognizes digit numbers ("50", "1,000", "2.5", "-3") and English number words
// ("a hundred", "twenty five", "three hundred and six", "a dozen", "a thousand").

export interface FoundNumber {
  value: number;
  /** UTF-16 offset of the first character of the number in the input. */
  start: number;
  /** UTF-16 offset just past the last character of the number. */
  end: number;
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };

interface Token {
  text: string;
  start: number;
  end: number;
}

// Digit numbers (optional sign, thousands separators, decimals) or words (letters and hyphens).
const TOKEN_RE = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?|[a-z]+(?:-[a-z]+)*/g;

function tokenize(text: string): Token[] {
  const lower = text.toLowerCase();
  const out: Token[] = [];
  for (const m of lower.matchAll(TOKEN_RE)) {
    const start = m.index;
    const word = m[0];
    // "twenty-five" is split into its parts so it is parsed like "twenty five".
    if (/[a-z]/.test(word) && word.includes('-')) {
      let offset = start;
      for (const part of word.split('-')) {
        out.push({ text: part, start: offset, end: offset + part.length });
        offset += part.length + 1;
      }
    } else {
      out.push({ text: word, start, end: start + word.length });
    }
  }
  return out;
}

const isNumberWord = (w: string) => w in UNITS || w in TENS || w in SCALES || w === 'dozen';

/**
 * All numbers in `text`, in text order. Word sequences are combined, so "three hundred and six"
 * is one number (306). "a" or "an" directly before "hundred", "thousand", "million", or "dozen"
 * counts as one. Digit numbers followed by a scale word are multiplied ("2 hundred" is 200).
 */
export function findNumbers(text: string): FoundNumber[] {
  const tokens = tokenize(text);
  const found: FoundNumber[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    const next = tokens[i + 1]?.text;
    const isDigit = /\d/.test(t.text);
    const article = (t.text === 'a' || t.text === 'an') && next !== undefined && (next in SCALES || next === 'dozen');
    if (!isDigit && !isNumberWord(t.text) && !article) {
      i++;
      continue;
    }

    let total = 0;
    let current = 0;
    let end = t.end;
    let j = i;
    if (isDigit) {
      current = Number(t.text.replace(/,/g, ''));
      j = i + 1;
    } else if (article) {
      current = 1;
      j = i + 1;
    }
    let sawWord = false;
    while (j < tokens.length) {
      const w = tokens[j]!.text;
      if (w === 'and' && sawWord && tokens[j + 1] && isNumberWord(tokens[j + 1]!.text) && !(tokens[j + 1]!.text in SCALES)) {
        j++;
        continue;
      }
      if (w in UNITS) {
        if (isDigit && !sawWord) break;
        current += UNITS[w]!;
      } else if (w in TENS) {
        if (isDigit && !sawWord) break;
        current += TENS[w]!;
      } else if (w === 'dozen') {
        current = (current || 1) * 12;
      } else if (w in SCALES) {
        const scale = SCALES[w]!;
        if (scale === 100) current = (current || 1) * 100;
        else {
          total += (current || 1) * scale;
          current = 0;
        }
      } else break;
      sawWord = true;
      end = tokens[j]!.end;
      j++;
    }
    found.push({ value: total + current, start: t.start, end });
    i = Math.max(j, i + 1);
  }
  return found;
}

/** The first number in `text`, or `undefined` when there is none. */
export function firstNumber(text: string): number | undefined {
  return findNumbers(text)[0]?.value;
}
