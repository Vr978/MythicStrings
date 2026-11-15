// Parameter schemas for the initial Move_Primitives (design: "Move_Primitive registry").
// Kept in core so the parser does not depend on Rapier. Schemas are frozen: a breaking
// change needs a new primitive name or version (Req 12.4).
import { PrimitiveRegistry } from './registry';
import type { ParamSchema, PrimitiveDescriptor } from './types';

/** Rig segment roles (design: RigSpec segment `role`). */
export const SEGMENT_ROLES = [
  'head',
  'torso',
  'pelvis',
  'upper_arm',
  'forearm',
  'hand',
  'thigh',
  'shin',
  'foot',
  'accessory',
] as const;

const schema = (s: ParamSchema): ParamSchema => Object.freeze(s.map((p) => Object.freeze(p)));

const descriptor = (name: string, paramSchema: ParamSchema): PrimitiveDescriptor =>
  Object.freeze({ name, version: 1, paramSchema: schema(paramSchema) });

export const APPLY_IMPULSE = descriptor('apply_impulse', [
  { name: 'segment', type: 'enum', required: true, values: SEGMENT_ROLES },
  { name: 'magnitude', type: 'number', required: true, min: 0, max: 5000 },
  { name: 'angleDeg', type: 'number', required: true, min: -180, max: 180 },
]);

export const PROJECTILE_VOLLEY = descriptor('projectile_volley', [
  { name: 'count', type: 'integer', required: true, min: 1, max: 100 },
  {
    name: 'projectileShape',
    type: 'enum',
    required: true,
    values: ['arrow', 'spear', 'disc', 'stone', 'fireball'],
  },
  { name: 'speed', type: 'number', required: true, min: 1, max: 60 },
  { name: 'spreadDeg', type: 'number', required: true, min: 0, max: 90 },
  { name: 'intervalMs', type: 'integer', required: true, min: 0, max: 500 },
]);

export const SPAWN_CLONES = descriptor('spawn_clones', [
  { name: 'count', type: 'integer', required: true, min: 1, max: 8 },
  { name: 'source', type: 'enum', required: true, values: ['hair', 'shadow', 'body'] },
  { name: 'lifetimeMs', type: 'integer', required: true, min: 500, max: 6000 },
  { name: 'behavior', type: 'enum', required: true, values: ['charge', 'surround', 'mirror'] },
]);

export const SUMMON_OBJECT = descriptor('summon_object', [
  {
    name: 'object',
    type: 'enum',
    required: true,
    values: ['boulder', 'wall', 'chariot_wheel', 'serpent', 'mace'],
  },
  { name: 'sizeScale', type: 'number', required: true, min: 0.25, max: 3 },
  { name: 'dropHeight', type: 'number', required: true, min: 0, max: 10 },
]);

export const DEFAULT_PRIMITIVE_DESCRIPTORS: readonly PrimitiveDescriptor[] = Object.freeze([
  APPLY_IMPULSE,
  PROJECTILE_VOLLEY,
  SPAWN_CLONES,
  SUMMON_OBJECT,
]);

/** A fresh registry holding the four initial primitive descriptors. */
export function createDefaultRegistry(): PrimitiveRegistry {
  const registry = new PrimitiveRegistry();
  for (const d of DEFAULT_PRIMITIVE_DESCRIPTORS) {
    const r = registry.register(d);
    if (!r.ok) throw new Error(r.error.message);
  }
  return registry;
}
