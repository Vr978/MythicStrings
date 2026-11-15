// Move_Block equivalence (Req 13.4) and the storage key for library idempotence (Req 14.6).
import { canonicalStringify, type CanonicalJson } from './print';
import type { MoveBlock, ParamValue, PrimitiveInvocation } from './types';

const sameParams = (a: Record<string, ParamValue>, b: Record<string, ParamValue>): boolean => {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  // `===` treats -0 and 0 as equal, matching the printer's normalization.
  return ka.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
};

const sameInvocations = (a: readonly PrimitiveInvocation[], b: readonly PrimitiveInvocation[]): boolean =>
  a.length === b.length &&
  a.every((inv, i) => inv.primitive === b[i]!.primitive && sameParams(inv.params, b[i]!.params));

/**
 * Same schema version, display name, description, target rules, and the same invocations
 * in the same order with identical primitive names and parameter values (Req 13.4).
 */
export function equivalentMoveBlocks(a: MoveBlock, b: MoveBlock): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.displayName === b.displayName &&
    a.description === b.description &&
    a.targets.primary === b.targets.primary &&
    a.targets.affects === b.targets.affects &&
    sameInvocations(a.primitives, b.primitives)
  );
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** 64-bit FNV-1a over the UTF-8 bytes of `s`, as 16 lowercase hex digits. */
export function fnv1a64(s: string): string {
  let h = FNV64_OFFSET;
  for (const byte of new TextEncoder().encode(s)) {
    h ^= BigInt(byte);
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * Stable key over the canonical printing of `primitives` only. Display name, description,
 * and targets are excluded because library equivalence (Req 14.6) is defined by primitives
 * and parameter values alone.
 */
export function canonicalKey(block: MoveBlock): string {
  return `fnv1a64:${fnv1a64(canonicalStringify(block.primitives as unknown as CanonicalJson))}`;
}
