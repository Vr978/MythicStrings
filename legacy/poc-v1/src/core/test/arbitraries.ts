// Shared fast-check generators (design: "Testing Strategy").
// `arbMoveBlock` is derived from the registry's parameter schemas, so newly registered
// primitives are covered without changing this file.
import fc from 'fast-check';
import {
  DESCRIPTION_MAX,
  DISPLAY_NAME_MAX,
  MOVE_BLOCK_SCHEMA_VERSION,
  PRIMITIVES_MAX,
  PRIMITIVES_MIN,
  TARGET_AFFECTS_VALUES,
  TARGET_PRIMARY_VALUES,
  type MoveBlock,
  type ParamSpec,
  type ParamValue,
  type PrimitiveDescriptor,
  type PrimitiveInvocation,
  type RegistryView,
  type TargetRules,
} from '../moveblock';

/** One Unicode scalar value (never a lone surrogate), biased toward non-ASCII and emoji. */
const scalar = (min: number, max: number): fc.Arbitrary<number> => fc.integer({ min, max });
export const arbCodePoint: fc.Arbitrary<string> = fc
  .oneof(
    { weight: 3, arbitrary: scalar(0x20, 0x7e) }, // printable ASCII
    { weight: 1, arbitrary: scalar(0x00, 0x1f) }, // control characters (escaped in JSON)
    { weight: 2, arbitrary: scalar(0x00a0, 0x024f) }, // Latin-1 and Latin Extended
    { weight: 2, arbitrary: scalar(0x0900, 0x097f) }, // Devanagari
    { weight: 2, arbitrary: scalar(0x0300, 0x036f) }, // combining diacritics
    { weight: 1, arbitrary: fc.constantFrom(0x200d, 0xfe0f, 0x2028, 0x2029) }, // ZWJ, VS16, line/para separators
    { weight: 3, arbitrary: scalar(0x1f300, 0x1faff) }, // emoji (astral, two UTF-16 units)
    { weight: 1, arbitrary: scalar(0x1f3fb, 0x1f3ff) }, // skin-tone modifiers
    { weight: 1, arbitrary: scalar(0xe000, 0x10ffff) }, // anything past the surrogate block
  )
  .map((cp) => String.fromCodePoint(cp));

/** A string of `minLength..maxLength` Unicode code points. */
export const arbText = (minLength: number, maxLength: number): fc.Arbitrary<string> =>
  fc.array(arbCodePoint, { minLength, maxLength }).map((cps) => cps.join(''));

/** Narrows a numeric parameter's generated range; values stay inside the schema range. */
export interface NumericRangeOverride {
  min?: number;
  max?: number;
}

export interface ArbMoveBlockOptions {
  /** Defaults to 1. */
  minPrimitives?: number;
  /** Defaults to 10 (the schema maximum). */
  maxPrimitives?: number;
  /** Restrict generation to these primitive names. Defaults to every registered primitive. */
  primitiveNames?: readonly string[];
  /**
   * Per-primitive, per-parameter numeric range narrowing, e.g.
   * `{ projectile_volley: { count: { max: 5 } } }`. Intersected with the schema range.
   */
  paramRanges?: Readonly<Record<string, Readonly<Record<string, NumericRangeOverride>>>>;
  /** Defaults to 40 code points (the schema maximum). */
  maxDisplayNameLength?: number;
  /** Defaults to 280 code points (the schema maximum). */
  maxDescriptionLength?: number;
}

function arbParamValue(spec: ParamSpec, override: NumericRangeOverride | undefined): fc.Arbitrary<ParamValue> {
  switch (spec.type) {
    case 'number':
    case 'integer': {
      const min = Math.max(spec.min, override?.min ?? spec.min);
      const max = Math.min(spec.max, override?.max ?? spec.max);
      if (min > max) throw new RangeError(`empty range for parameter "${spec.name}": ${min} to ${max}`);
      if (spec.type === 'integer') {
        const lo = Math.ceil(min);
        const hi = Math.floor(max);
        if (lo > hi) throw new RangeError(`no integer in range for parameter "${spec.name}"`);
        return fc.integer({ min: lo, max: hi });
      }
      // Includes the bounds, -0 when 0 is in range, and subnormals.
      return fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
    }
    case 'enum':
      return fc.constantFrom(...spec.values);
    case 'boolean':
      return fc.boolean();
  }
}

/** Valid params for one primitive; optional parameters are sometimes omitted. */
export function arbParams(
  descriptor: PrimitiveDescriptor,
  overrides?: Readonly<Record<string, NumericRangeOverride>>,
): fc.Arbitrary<Record<string, ParamValue>> {
  const model: Record<string, fc.Arbitrary<ParamValue>> = {};
  for (const spec of descriptor.paramSchema) model[spec.name] = arbParamValue(spec, overrides?.[spec.name]);
  const requiredKeys = descriptor.paramSchema.filter((s) => s.required).map((s) => s.name);
  return fc.record(model, { requiredKeys }) as fc.Arbitrary<Record<string, ParamValue>>;
}

export function arbInvocation(
  registry: RegistryView,
  options: Pick<ArbMoveBlockOptions, 'primitiveNames' | 'paramRanges'> = {},
): fc.Arbitrary<PrimitiveInvocation> {
  const descriptors = (options.primitiveNames ?? registry.list().map((d) => d.name)).map((name) => {
    const d = registry.get(name);
    if (!d) throw new Error(`Move_Primitive "${name}" is not registered`);
    return d;
  });
  if (descriptors.length === 0) throw new Error('arbInvocation needs at least one registered primitive');
  return fc.oneof(
    ...descriptors.map((d) =>
      arbParams(d, options.paramRanges?.[d.name]).map((params) => ({ primitive: d.name, params })),
    ),
  );
}

export const arbTargetRules: fc.Arbitrary<TargetRules> = fc.record({
  primary: fc.constantFrom(...TARGET_PRIMARY_VALUES),
  affects: fc.constantFrom(...TARGET_AFFECTS_VALUES),
});

/** A Move_Block that conforms to the Move_Block_Schema for `registry`. */
export function arbMoveBlock(registry: RegistryView, options: ArbMoveBlockOptions = {}): fc.Arbitrary<MoveBlock> {
  const minPrimitives = Math.max(PRIMITIVES_MIN, options.minPrimitives ?? PRIMITIVES_MIN);
  const maxPrimitives = Math.min(PRIMITIVES_MAX, options.maxPrimitives ?? PRIMITIVES_MAX);
  if (minPrimitives > maxPrimitives) throw new RangeError('minPrimitives exceeds maxPrimitives');
  const maxName = Math.min(DISPLAY_NAME_MAX, Math.max(1, options.maxDisplayNameLength ?? DISPLAY_NAME_MAX));
  const maxDescription = Math.min(DESCRIPTION_MAX, Math.max(1, options.maxDescriptionLength ?? DESCRIPTION_MAX));
  return fc.record({
    schemaVersion: fc.constant(MOVE_BLOCK_SCHEMA_VERSION),
    displayName: arbText(1, maxName),
    description: arbText(1, maxDescription),
    primitives: fc.array(arbInvocation(registry, options), { minLength: minPrimitives, maxLength: maxPrimitives }),
    targets: arbTargetRules,
  });
}
