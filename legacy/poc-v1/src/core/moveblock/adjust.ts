// Parameter adjustment of a reused Move_Library entry (Req 14.4). Only parameter values change:
// the result keeps the same primitives in the same order, and the input block is never mutated.
import type { RegistryView } from './registry';
import type { MoveBlock, ParamValue } from './types';

/** One parameter change on the invocation at `index`. */
export interface ParamChange {
  index: number;
  param: string;
  value: ParamValue;
}

export interface RejectedChange {
  /** Position of the rejected change in the `changes` list. */
  change: number;
  reason: string;
}

export interface AdjustOutcome {
  block: MoveBlock;
  /** Changes that were not applied, in input order. Empty when every change was applied. */
  rejected: RejectedChange[];
}

/**
 * Applies `changes`, in order, to a copy of `block`. A change is rejected (skipped and reported)
 * when its index is not an existing invocation, the primitive is unregistered, the parameter is
 * not in the primitive's schema (so a change cannot rename a primitive or add an invocation), or
 * the value has the wrong type for that parameter (including NaN and infinities, and enum strings
 * outside the allowed values). Numeric values are clamped to the schema bounds; integer
 * parameters are rounded to the nearest integer first.
 */
export function applyParamAdjustments(
  block: MoveBlock,
  changes: readonly ParamChange[],
  registry: RegistryView,
): AdjustOutcome {
  const primitives = block.primitives.map((inv) => ({ primitive: inv.primitive, params: { ...inv.params } }));
  const rejected: RejectedChange[] = [];
  changes.forEach(({ index, param, value }, c) => {
    const reject = (reason: string) => void rejected.push({ change: c, reason });
    const inv = Number.isInteger(index) ? primitives[index] : undefined;
    if (!inv) return reject(`no invocation at index ${index}`);
    const spec = registry.get(inv.primitive)?.paramSchema.find((p) => p.name === param);
    if (!spec) return reject(`"${param}" is not a parameter of ${inv.primitive}`);
    switch (spec.type) {
      case 'number':
      case 'integer': {
        if (typeof value !== 'number' || !Number.isFinite(value)) return reject(`"${param}" needs a finite number`);
        const v = spec.type === 'integer' ? Math.round(value) : value;
        // `+ 0` turns -0 into 0.
        inv.params[param] = Math.min(spec.max, Math.max(spec.min, v)) + 0;
        return;
      }
      case 'enum':
        if (typeof value !== 'string' || !spec.values.includes(value)) return reject(`"${param}" needs one of ${spec.values.join(', ')}`);
        inv.params[param] = value;
        return;
      case 'boolean':
        if (typeof value !== 'boolean') return reject(`"${param}" needs a boolean`);
        inv.params[param] = value;
        return;
    }
  });
  return { block: { ...block, targets: { ...block.targets }, primitives }, rejected };
}
