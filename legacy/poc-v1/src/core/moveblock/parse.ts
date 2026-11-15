// Move_Parser (Req 12.6-12.8, 13.1, 13.2, 13.5). Order: byte size, JSON syntax, then the
// schema check in fixed field order. On any failure no Move_Block is returned.
import type { RegistryView } from './registry';
import { err, type MoveBlock, type Result } from './types';
import { validateMoveBlockValue, type SchemaError } from './validate';

/** 64 KB (Req 13.5). */
export const MAX_DOCUMENT_BYTES = 65_536;

export interface SizeLimitError {
  kind: 'size_limit';
  path: '';
  reason: string;
  byteLength: number;
  limit: number;
}

export interface JsonSyntaxError {
  kind: 'syntax';
  path: '';
  reason: string;
  /** 1-based. */
  line: number;
  /** 1-based, counted in Unicode code points. */
  column: number;
}

export type ParseError = SizeLimitError | JsonSyntaxError | SchemaError;

/** UTF-8 byte length, stopping early once `limit` is exceeded. Lone surrogates count as 3 bytes (U+FFFD). */
export function utf8ByteLength(s: string, limit = Infinity): number {
  let bytes = 0;
  for (let i = 0; i < s.length && bytes <= limit; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export function parseMoveBlock(doc: string, registry: RegistryView): Result<MoveBlock, ParseError> {
  // Each UTF-16 unit is at least one UTF-8 byte, so a long string is rejected without scanning.
  const byteLength = doc.length > MAX_DOCUMENT_BYTES ? doc.length : utf8ByteLength(doc, MAX_DOCUMENT_BYTES);
  if (byteLength > MAX_DOCUMENT_BYTES) {
    return err({
      kind: 'size_limit',
      path: '',
      reason: `document exceeds the ${MAX_DOCUMENT_BYTES}-byte size limit`,
      byteLength,
      limit: MAX_DOCUMENT_BYTES,
    });
  }

  let value: unknown;
  try {
    value = JSON.parse(doc);
  } catch (e) {
    return err(syntaxError(doc, e));
  }
  return validateMoveBlockValue(value, registry);
}

function syntaxError(doc: string, cause: unknown): JsonSyntaxError {
  const found = locateJsonSyntaxError(doc);
  const offset = found?.offset ?? 0;
  const reason = found?.reason ?? (cause instanceof Error ? cause.message : 'malformed JSON');
  const { line, column } = lineColumn(doc, offset);
  return { kind: 'syntax', path: '', reason, line, column };
}

/** 1-based line and code-point column of a UTF-16 offset. */
export function lineColumn(doc: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < doc.length; i++) {
    const c = doc.charCodeAt(i);
    if (c === 0x0a) {
      line++;
      column = 1;
    } else if (c >= 0xdc00 && c <= 0xdfff && i > 0 && isHighSurrogate(doc.charCodeAt(i - 1))) {
      // second half of a surrogate pair: same code point
    } else {
      column++;
    }
  }
  return { line, column };
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;

/**
 * Finds the offset of the first JSON syntax error (RFC 8259). Engine error messages differ
 * in whether and how they report a position, so the location is computed here. Iterative,
 * so deep nesting cannot overflow the stack. Returns null if the document is valid JSON.
 */
export function locateJsonSyntaxError(doc: string): { offset: number; reason: string } | null {
  const n = doc.length;
  let i = 0;
  const stack: ('{' | '[')[] = [];
  const at = (offset: number, reason: string) => ({ offset, reason });
  const unexpected = (offset: number) =>
    offset >= n ? at(n, 'unexpected end of input') : at(offset, `unexpected character ${JSON.stringify(doc[offset])}`);
  const skipWs = () => {
    while (i < n) {
      const c = doc[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
      else break;
    }
  };
  /** Scans a string starting at `i` (which must be '"'); returns an error or null. */
  const scanString = () => {
    i++;
    while (i < n) {
      const c = doc.charCodeAt(i);
      if (c === 0x22) {
        i++;
        return null;
      }
      if (c < 0x20) return at(i, 'unescaped control character in string');
      if (c === 0x5c) {
        const e = doc[i + 1];
        if (e === undefined) return at(n, 'unexpected end of input');
        if ('"\\/bfnrt'.includes(e)) i += 2;
        else if (e === 'u') {
          for (let k = 2; k < 6; k++) {
            if (!/[0-9a-fA-F]/.test(doc[i + k] ?? '')) {
              return i + k >= n ? at(n, 'unexpected end of input') : at(i + k, 'invalid unicode escape');
            }
          }
          i += 6;
        } else return at(i + 1, `invalid escape character ${JSON.stringify(e)}`);
      } else i++;
    }
    return at(n, 'unterminated string');
  };
  const digits = () => {
    const start = i;
    while (i < n && doc[i]! >= '0' && doc[i]! <= '9') i++;
    return i > start;
  };
  const scanNumber = () => {
    if (doc[i] === '-') i++;
    if (doc[i] === '0') i++;
    else if (!digits()) return unexpected(i);
    if (doc[i] === '.') {
      i++;
      if (!digits()) return unexpected(i);
    }
    if (doc[i] === 'e' || doc[i] === 'E') {
      i++;
      if (doc[i] === '+' || doc[i] === '-') i++;
      if (!digits()) return unexpected(i);
    }
    return null;
  };
  /** Scans an object key and the following colon. */
  const scanKey = () => {
    skipWs();
    if (doc[i] !== '"') return i >= n ? unexpected(i) : at(i, 'expected property name');
    const e = scanString();
    if (e) return e;
    skipWs();
    if (doc[i] !== ':') return i >= n ? unexpected(i) : at(i, "expected ':'");
    i++;
    return null;
  };

  let expectValue = true;
  for (;;) {
    if (expectValue) {
      skipWs();
      const c = doc[i];
      if (c === '{') {
        i++;
        skipWs();
        if (doc[i] === '}') {
          i++;
          expectValue = false;
          continue;
        }
        stack.push('{');
        const e = scanKey();
        if (e) return e;
        continue;
      }
      if (c === '[') {
        i++;
        skipWs();
        if (doc[i] === ']') {
          i++;
          expectValue = false;
          continue;
        }
        stack.push('[');
        continue;
      }
      if (c === '"') {
        const e = scanString();
        if (e) return e;
      } else if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) {
        const e = scanNumber();
        if (e) return e;
      } else {
        const lit = ['true', 'false', 'null'].find((w) => doc.startsWith(w, i));
        if (!lit) return unexpected(i);
        i += lit.length;
      }
      expectValue = false;
      continue;
    }

    skipWs();
    const top = stack[stack.length - 1];
    if (top === undefined) return i < n ? at(i, 'unexpected content after JSON value') : null;
    const c = doc[i];
    if (c === ',') {
      i++;
      if (top === '{') {
        const e = scanKey();
        if (e) return e;
      }
      expectValue = true;
    } else if ((top === '{' && c === '}') || (top === '[' && c === ']')) {
      i++;
      stack.pop();
    } else {
      return i >= n ? unexpected(i) : at(i, top === '{' ? "expected ',' or '}'" : "expected ',' or ']'");
    }
  }
}
