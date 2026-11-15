// Trait set validation (Req 5.1, 5.2) and cross-character balance (Req 5.6).
import type { Result } from '../moveblock/types';
import type { PuppetCharacter, Trait } from './types';

export const TRAIT_COUNT_MIN = 3;
export const TRAIT_COUNT_MAX = 6;
export const TRAIT_NAME_MAX = 40;
export const TRAIT_DESCRIPTION_MAX = 200;
export const TRAIT_MAGNITUDE_MIN = 1;
export const TRAIT_MAGNITUDE_MAX = 10;
/** Maximum allowed difference between the largest and smallest per-character magnitude sums. */
export const TRAIT_BALANCE_MAX_SPREAD = 10;

export interface TraitError {
  /** e.g. `traits`, `traits[2].name`. */
  path: string;
  reason: string;
}

/** Length in Unicode code points, so emoji and non-BMP text count as one character each. */
const codePointLength = (s: string): number => [...s].length;

function checkText(value: unknown, path: string, max: number): TraitError | null {
  if (typeof value !== 'string') return { path, reason: 'must be a string' };
  if (value.trim().length === 0) return { path, reason: 'must not be empty' };
  if (codePointLength(value) > max) return { path, reason: `must be at most ${max} characters` };
  return null;
}

/**
 * Checks one Puppet_Character's Trait set: 3..6 Traits, name 1..40 characters, description
 * 1..200 characters, integer magnitude 1..10, names unique ignoring case. Returns the first
 * problem found, checking Traits in order and fields in the order name, description, magnitude.
 */
export function validateTraitSet(traits: unknown): Result<Trait[], TraitError> {
  if (!Array.isArray(traits)) return { ok: false, error: { path: 'traits', reason: 'must be an array' } };
  if (traits.length < TRAIT_COUNT_MIN || traits.length > TRAIT_COUNT_MAX) {
    return {
      ok: false,
      error: { path: 'traits', reason: `must have ${TRAIT_COUNT_MIN} to ${TRAIT_COUNT_MAX} Traits` },
    };
  }
  const seen = new Set<string>();
  const out: Trait[] = [];
  for (let i = 0; i < traits.length; i++) {
    const t: unknown = traits[i];
    const base = `traits[${i}]`;
    if (typeof t !== 'object' || t === null) return { ok: false, error: { path: base, reason: 'must be an object' } };
    const { name, description, magnitude } = t as Record<string, unknown>;
    const nameErr = checkText(name, `${base}.name`, TRAIT_NAME_MAX);
    if (nameErr) return { ok: false, error: nameErr };
    const descErr = checkText(description, `${base}.description`, TRAIT_DESCRIPTION_MAX);
    if (descErr) return { ok: false, error: descErr };
    if (
      typeof magnitude !== 'number' ||
      !Number.isInteger(magnitude) ||
      magnitude < TRAIT_MAGNITUDE_MIN ||
      magnitude > TRAIT_MAGNITUDE_MAX
    ) {
      return {
        ok: false,
        error: {
          path: `${base}.magnitude`,
          reason: `must be an integer from ${TRAIT_MAGNITUDE_MIN} to ${TRAIT_MAGNITUDE_MAX}`,
        },
      };
    }
    const key = (name as string).trim().toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: { path: `${base}.name`, reason: 'duplicates another Trait name (case-insensitive)' } };
    }
    seen.add(key);
    out.push({ name: name as string, description: description as string, magnitude });
  }
  return { ok: true, value: out };
}

export const traitMagnitudeSum = (traits: readonly Trait[]): number =>
  traits.reduce((sum, t) => sum + t.magnitude, 0);

/** True when per-character Trait magnitude sums differ by at most 10 (Req 5.6). */
export function traitBalanceOk(scenario: { characters: readonly Pick<PuppetCharacter, 'traits'>[] }): boolean {
  if (scenario.characters.length === 0) return true;
  const sums = scenario.characters.map((c) => traitMagnitudeSum(c.traits));
  return Math.max(...sums) - Math.min(...sums) <= TRAIT_BALANCE_MAX_SPREAD;
}
