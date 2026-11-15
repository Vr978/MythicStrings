// Feature: mythic-strings-shadow-puppet-battle, Property 2: Deterministic printing
// **Validates: Requirements 13.7**
//
// For any two equivalent Move_Block objects, including objects whose keys were inserted
// in different orders and parameters equal to -0 versus 0, the Move_Printer returns
// byte-identical documents.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createDefaultRegistry,
  DEFAULT_PRIMITIVE_DESCRIPTORS,
  equivalentMoveBlocks,
  printMoveBlock,
  TARGET_AFFECTS_VALUES,
  TARGET_PRIMARY_VALUES,
  type MoveBlock,
  type ParamSpec,
  type ParamValue,
  type PrimitiveDescriptor,
} from './index';

const registry = createDefaultRegistry();

// Local generators (shared arbitraries live elsewhere and are owned by another task).

/** Values for one parameter; zero is weighted heavily when the range allows it. */
const arbParamValue = (spec: ParamSpec): fc.Arbitrary<ParamValue> => {
  switch (spec.type) {
    case 'enum':
      return fc.constantFrom(...spec.values);
    case 'boolean':
      return fc.boolean();
    case 'integer':
    case 'number': {
      const base =
        spec.type === 'integer'
          ? fc.integer({ min: spec.min, max: spec.max })
          : fc.double({ min: spec.min, max: spec.max, noNaN: true, noDefaultInfinity: true });
      const zeroAllowed = spec.min <= 0 && spec.max >= 0;
      return zeroAllowed ? fc.oneof(fc.constant(0), base) : base;
    }
  }
};

const arbInvocation = (d: PrimitiveDescriptor) =>
  fc.record(Object.fromEntries(d.paramSchema.map((p) => [p.name, arbParamValue(p)]))).map((params) => ({
    primitive: d.name,
    params: params as Record<string, ParamValue>,
  }));

/** 1..n code points, including non-ASCII and astral characters. */
const arbText = (max: number) => fc.string({ unit: 'binary', minLength: 1, maxLength: max });

const arbMoveBlock: fc.Arbitrary<MoveBlock> = fc.record({
  schemaVersion: fc.constant(1 as const),
  displayName: arbText(40),
  description: arbText(280),
  primitives: fc.array(fc.oneof(...DEFAULT_PRIMITIVE_DESCRIPTORS.map(arbInvocation)), {
    minLength: 1,
    maxLength: 10,
  }),
  targets: fc.record({
    primary: fc.constantFrom(...TARGET_PRIMARY_VALUES),
    affects: fc.constantFrom(...TARGET_AFFECTS_VALUES),
  }),
});

/** Small deterministic PRNG so a single generated seed drives every shuffle and sign flip. */
const mulberry32 = (seed: number) => () => {
  let t = (seed = (seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const shuffled = <T>(xs: readonly T[], rand: () => number): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

/**
 * Deep copy with object keys inserted in a random order and every zero randomly
 * replaced by 0 or -0. Array order is preserved, so the copy stays equivalent.
 */
function rebuild(value: unknown, rand: () => number): unknown {
  if (typeof value === 'number') return value === 0 ? (rand() < 0.5 ? -0 : 0) : value;
  if (Array.isArray(value)) return value.map((v) => rebuild(v, rand));
  if (typeof value === 'object' && value !== null) {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of shuffled(Object.keys(src), rand)) out[k] = rebuild(src[k], rand);
    return out;
  }
  return value;
}

describe('Property 2: Deterministic printing', () => {
  it('prints equivalent Move_Blocks (shuffled keys, -0 vs 0) to byte-identical documents', () => {
    fc.assert(
      fc.property(arbMoveBlock, fc.integer(), fc.integer(), (block, seedA, seedB) => {
        const a = rebuild(block, mulberry32(seedA)) as MoveBlock;
        const b = rebuild(block, mulberry32(seedB)) as MoveBlock;
        expect(equivalentMoveBlocks(a, b)).toBe(true);

        const pa = printMoveBlock(a, registry);
        const pb = printMoveBlock(b, registry);
        expect(pa.ok).toBe(true);
        expect(pb.ok).toBe(true);
        if (!pa.ok || !pb.ok) return;
        expect(pa.value).toBe(pb.value);
        expect(new TextEncoder().encode(pa.value)).toEqual(new TextEncoder().encode(pb.value));
      }),
      { numRuns: 100 },
    );
  });

  it('prints a block with -0 parameters identically to the same block with 0', () => {
    const base: MoveBlock = {
      schemaVersion: 1,
      displayName: 'Gada Prahar',
      description: 'Duryodhana swings the mace.',
      primitives: [{ primitive: 'apply_impulse', params: { segment: 'hand', magnitude: 0, angleDeg: 0 } }],
      targets: { primary: 'selected_opponent', affects: 'primary_only' },
    };
    const negated: MoveBlock = {
      targets: { affects: 'primary_only', primary: 'selected_opponent' },
      primitives: [{ params: { angleDeg: -0, magnitude: -0, segment: 'hand' }, primitive: 'apply_impulse' }],
      description: 'Duryodhana swings the mace.',
      displayName: 'Gada Prahar',
      schemaVersion: 1,
    };
    const pa = printMoveBlock(base, registry);
    const pb = printMoveBlock(negated, registry);
    expect(pa).toEqual(pb);
    expect(pa.ok && pa.value).not.toContain('-0');
  });
});
