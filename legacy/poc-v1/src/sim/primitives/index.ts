// Name -> implementation map for the Move_Primitives shipped with the build (Req 12.2).
// Checked at module load against `createDefaultRegistry()`, so a schema without an implementation
// (or the reverse) fails at startup rather than mid-Battle.
import { createDefaultRegistry } from '../../core/moveblock/primitiveSchemas';
import type { RegistryView } from '../../core/moveblock/registry';
import { applyImpulse } from './applyImpulse';
import { projectileVolley } from './projectileVolley';
import { spawnClones } from './spawnClones';
import { summonObject } from './summonObject';
import type { MovePrimitiveImpl } from './types';

export * from './types';
export { applyImpulse, projectileVolley, spawnClones, summonObject };

/** A Map (not an object) so names such as `__proto__` or `constructor` can never resolve. */
export const PRIMITIVE_IMPLEMENTATIONS: ReadonlyMap<string, MovePrimitiveImpl> = new Map(
  [applyImpulse, projectileVolley, spawnClones, summonObject].map((p) => [p.name, p] as const),
);

export interface ImplementationCoverage {
  /** Registered schemas with no implementation. */
  missing: string[];
  /** Implementations with no registered schema. */
  unregistered: string[];
}

export function checkImplementations(
  registry: RegistryView,
  impls: ReadonlyMap<string, MovePrimitiveImpl> = PRIMITIVE_IMPLEMENTATIONS,
): ImplementationCoverage {
  const names = registry.list().map((d) => d.name);
  return {
    missing: names.filter((n) => !impls.has(n)),
    unregistered: [...impls.keys()].filter((n) => !registry.has(n)),
  };
}

/** Throws when the default registry and the implementation map disagree. */
export function assertImplementationsCover(registry: RegistryView = createDefaultRegistry()): void {
  const { missing, unregistered } = checkImplementations(registry);
  if (missing.length > 0 || unregistered.length > 0) {
    throw new Error(
      `Move_Primitive implementations out of sync: missing [${missing.join(', ')}], unregistered [${unregistered.join(', ')}]`,
    );
  }
}

assertImplementationsCover();
