// Move_Printer (Req 13.3, 13.6, 13.7): validate first, then emit canonical JSON.
import type { RegistryView } from './registry';
import { ok, type MoveBlock, type Result } from './types';
import { validateMoveBlockValue, type SchemaError } from './validate';

export type PrintError = SchemaError;

export type CanonicalJson = null | boolean | number | string | readonly CanonicalJson[] | { readonly [k: string]: CanonicalJson };

/**
 * Canonical JSON: no insignificant whitespace, object keys sorted by UTF-16 code unit
 * order (the default `Array.prototype.sort` comparison), array order preserved, `-0`
 * printed as `0`, other numbers in the shortest round-trip form. Non-finite numbers are
 * not representable and throw; callers validate first.
 */
export function canonicalStringify(value: CanonicalJson): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`non-finite number ${value} has no JSON form`);
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const obj = value as { readonly [k: string]: CanonicalJson };
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k]!)}`).join(',')}}`;
}

export function printMoveBlock(block: MoveBlock, registry: RegistryView): Result<string, PrintError> {
  const checked = validateMoveBlockValue(block, registry);
  if (!checked.ok) return checked;
  return ok(canonicalStringify(checked.value as unknown as CanonicalJson));
}
