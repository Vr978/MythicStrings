// Schema clamping before the second validation pass (Req 11.5, 14.4).
import type { RegistryView } from './registry';
import type { MoveBlock, ParamValue } from './types';

/**
 * Returns a copy of `block` in which every numeric parameter outside its schema range is
 * set to the nearest bound. Nothing else changes: in-range values, non-numeric values,
 * NaN, unknown parameters, and invocations of unregistered primitives are copied as is.
 * The input block is never mutated.
 */
export function clampToSchema(block: MoveBlock, registry: RegistryView): { block: MoveBlock; clamped: boolean } {
  let clamped = false;
  const primitives = block.primitives.map((inv) => {
    const params: Record<string, ParamValue> = { ...inv.params };
    const descriptor = registry.get(inv.primitive);
    for (const spec of descriptor?.paramSchema ?? []) {
      if (spec.type !== 'number' && spec.type !== 'integer') continue;
      if (!Object.hasOwn(params, spec.name)) continue;
      const v = params[spec.name];
      if (typeof v !== 'number') continue;
      if (v < spec.min) {
        params[spec.name] = spec.min;
        clamped = true;
      } else if (v > spec.max) {
        params[spec.name] = spec.max;
        clamped = true;
      }
    }
    return { primitive: inv.primitive, params };
  });
  return { block: { ...block, targets: { ...block.targets }, primitives }, clamped };
}
