// summon_object: drops one object (boulder, wall, chariot wheel, serpent, or mace) from `dropHeight`
// metres above the target's head, scaled by `sizeScale`. The object's mass is capped so that its
// impact momentum after the fall stays at or below MAX_IMPACT_IMPULSE, which the ragdoll joints hold.
import { SUMMON_OBJECT } from '../../core/moveblock/primitiveSchemas';
import type { EffectShape } from '../world';
import { G, readParams, topY, torsoPosition } from './shared';
import type { MovePrimitiveImpl } from './types';

type SummonedObject = 'boulder' | 'wall' | 'chariot_wheel' | 'serpent' | 'mace';

interface ObjectSpec {
  shape: (s: number) => EffectShape;
  /** Half the vertical extent at scale s, used to place the object fully above the head. */
  halfHeight: (s: number) => number;
  /** Mass in kg at sizeScale 1; grows with area before the impact cap. */
  baseMass: number;
  spin: number;
}

const OBJECTS: Record<SummonedObject, ObjectSpec> = {
  boulder: { shape: (s) => ({ type: 'ball', radius: 0.25 * s }), halfHeight: (s) => 0.25 * s, baseMass: 0.15, spin: 0 },
  mace: { shape: (s) => ({ type: 'ball', radius: 0.18 * s }), halfHeight: (s) => 0.18 * s, baseMass: 0.12, spin: 4 },
  wall: { shape: (s) => ({ type: 'cuboid', hx: 0.1 * s, hy: 0.5 * s }), halfHeight: (s) => 0.5 * s, baseMass: 0.2, spin: 0 },
  chariot_wheel: { shape: (s) => ({ type: 'ball', radius: 0.35 * s }), halfHeight: (s) => 0.35 * s, baseMass: 0.15, spin: 8 },
  serpent: { shape: (s) => ({ type: 'cuboid', hx: 0.5 * s, hy: 0.06 * s }), halfHeight: (s) => 0.06 * s, baseMass: 0.1, spin: 0 },
};

/** Largest momentum (N·s) a summoned object may carry when it reaches the target's head. */
export const MAX_IMPACT_IMPULSE = 2;
/** Gap between the head and the bottom of the object when dropHeight is 0. */
const HEAD_CLEARANCE_M = 0.2;
/** Summoned objects disappear after 4 s so the Stage does not fill up over a Battle. */
export const OBJECT_LIFETIME_STEPS = 240;

const area = (s: EffectShape): number =>
  s.type === 'ball' ? Math.PI * s.radius * s.radius : s.type === 'cuboid' ? 4 * s.hx * s.hy : 0.01;

export const summonObject: MovePrimitiveImpl = {
  name: SUMMON_OBJECT.name,
  descriptor: SUMMON_OBJECT,
  apply(ctx, raw) {
    const p = readParams(SUMMON_OBJECT, raw);
    const object = p.object as SummonedObject;
    const scale = p.sizeScale as number;
    const dropHeight = p.dropHeight as number;
    const spec = OBJECTS[object];

    ctx.at(0, () => {
      const { world, targetId } = ctx;
      const target = torsoPosition(world, targetId);
      const shape = spec.shape(scale);
      const fall = dropHeight + HEAD_CLEARANCE_M + 0.3; // head centre to crown is about 0.12 m, plus margin
      const impactSpeed = Math.sqrt(2 * G * fall);
      const mass = Math.min(spec.baseMass * scale * scale, MAX_IMPACT_IMPULSE / impactSpeed);
      ctx.spawn({
        kind: object,
        shape,
        position: { x: target.x, y: topY(world, targetId) + HEAD_CLEARANCE_M + dropHeight + spec.halfHeight(scale) },
        angvel: spec.spin,
        density: mass / area(shape),
        friction: 0.6,
        restitution: 0.1,
        lifetimeSteps: OBJECT_LIFETIME_STEPS,
      });
    });
  },
};
