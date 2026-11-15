// Move_Generator output validator (Req 9.5, 9.6). Stricter than the Move_Block schema: stored
// blocks may carry descriptions up to 280 characters, but generated ones must be one short sentence.
import { err, ok, type Result } from './types';

export const GENERATED_NAME_MAX = 40;
export const GENERATED_DESCRIPTION_MAX = 150;
export const GENERATED_NOTE_MAX = 200;

export interface GeneratedMeta {
  displayName: string;
  description: string;
  note?: string;
}

export interface MetaError {
  kind: 'meta';
  field: 'displayName' | 'description' | 'note';
  reason: string;
}

/** Length in Unicode code points. */
export const codePointLength = (s: string): number => [...s].length;

/**
 * True when `s` is exactly one sentence: no leading or trailing whitespace, at least one letter or
 * digit, ends with one of `.`, `!`, `?` (optionally repeated, such as "?!"), and contains no other
 * sentence terminator followed by whitespace before the end.
 */
export function isOneSentence(s: string): boolean {
  if (s.length === 0 || s.trim() !== s) return false;
  if (!/[\p{L}\p{N}]/u.test(s)) return false;
  const m = /[.!?]+$/.exec(s);
  if (!m) return false;
  const body = s.slice(0, m.index);
  return !/[.!?]\s/.test(body) && /[\p{L}\p{N}]/u.test(body);
}

/**
 * Accepts iff the display name has 1 to 40 code points, the description is exactly one sentence
 * of at most 150 code points, and the note, when present, has at most 200 code points.
 */
export function validateGeneratedMeta(meta: GeneratedMeta): Result<void, MetaError> {
  const nameLen = codePointLength(meta.displayName);
  if (nameLen < 1 || nameLen > GENERATED_NAME_MAX) {
    return err({ kind: 'meta', field: 'displayName', reason: `display name must have 1 to ${GENERATED_NAME_MAX} characters` });
  }
  if (codePointLength(meta.description) > GENERATED_DESCRIPTION_MAX) {
    return err({ kind: 'meta', field: 'description', reason: `description must have at most ${GENERATED_DESCRIPTION_MAX} characters` });
  }
  if (!isOneSentence(meta.description)) {
    return err({ kind: 'meta', field: 'description', reason: 'description must be exactly one sentence' });
  }
  if (meta.note !== undefined && codePointLength(meta.note) > GENERATED_NOTE_MAX) {
    return err({ kind: 'meta', field: 'note', reason: `note must have at most ${GENERATED_NOTE_MAX} characters` });
  }
  return ok(undefined);
}
