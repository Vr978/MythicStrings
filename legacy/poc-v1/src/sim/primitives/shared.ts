// Helpers shared by the Move_Primitive implementations: schema-checked parameter reading,
// time conversion, and puppet geometry queries.
import { PHYSICS_HZ } from '../../core/config';
import type { ParamValue, PrimitiveDescriptor } from '../../core/moveblock/types';
import type { SegmentRole, Vec2 } from '../../core/scenario/types';
import { GRAVITY_Y, type SimWorld } from '../world';
import { PrimitiveError } from './types';

export type ReadParams = Record<string, ParamValue>;

/**
 * Checks every declared parameter for presence, type, finiteness, and range, and returns them.
 * Out-of-range values are rejected rather than clamped so the validator's clamp-and-retry pass
 * (Req 11.5) stays the only place that rewrites parameters.
 */
export function readParams(descriptor: PrimitiveDescriptor, params: Readonly<Record<string, ParamValue>>): ReadParams {
  const out: ReadParams = {};
  for (const spec of descriptor.paramSchema) {
    const has = Object.prototype.hasOwnProperty.call(params, spec.name);
    const v = has ? params[spec.name] : undefined;
    const fail = (why: string): never => {
      throw new PrimitiveError(descriptor.name, `param ${spec.name} ${why}`);
    };
    if (v === undefined) {
      if (spec.required) fail('is required');
      continue;
    }
    switch (spec.type) {
      case 'number':
      case 'integer':
        if (typeof v !== 'number' || !Number.isFinite(v)) fail('must be a finite number');
        if (spec.type === 'integer' && !Number.isInteger(v)) fail('must be an integer');
        if ((v as number) < spec.min || (v as number) > spec.max) fail(`must be in [${spec.min}, ${spec.max}]`);
        break;
      case 'enum':
        if (typeof v !== 'string' || !spec.values.includes(v)) fail(`must be one of ${spec.values.join(', ')}`);
        break;
      case 'boolean':
        if (typeof v !== 'boolean') fail('must be a boolean');
        break;
    }
    out[spec.name] = v;
  }
  return out;
}

/** Milliseconds to whole simulation steps at the fixed 60 Hz rate. */
export const msToSteps = (ms: number): number => Math.round((ms * PHYSICS_HZ) / 1000);

export const G = Math.abs(GRAVITY_Y);

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const len = (v: Vec2): number => Math.hypot(v.x, v.y);
export const norm = (v: Vec2): Vec2 => {
  const l = len(v);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
};
export const rotate = (v: Vec2, rad: number): Vec2 => ({
  x: v.x * Math.cos(rad) - v.y * Math.sin(rad),
  y: v.x * Math.sin(rad) + v.y * Math.cos(rad),
});
export const deg2rad = (d: number): number => (d * Math.PI) / 180;

/** Roles absent from a rig fall back to the nearest equivalent segment. */
const ROLE_FALLBACK: Partial<Record<SegmentRole, SegmentRole[]>> = {
  hand: ['forearm', 'upper_arm'],
  forearm: ['hand', 'upper_arm'],
  upper_arm: ['forearm', 'hand'],
  foot: ['shin', 'thigh'],
  shin: ['foot', 'thigh'],
  thigh: ['shin', 'pelvis'],
  pelvis: ['torso'],
  accessory: ['hand', 'forearm'],
  head: ['torso'],
};

/** World position of a character's torso (its reference point). */
export function torsoPosition(world: SimWorld, id: string): Vec2 {
  const r = world.ragdoll(id);
  const t = world.segmentTransform(id, r.segments[r.torsoIndex]!.id);
  return { x: t.x, y: t.y };
}

/**
 * Picks the segment of `id` with `role` (or a fallback role) that lies closest to `toward`,
 * so a strike uses the front limb. Falls back to the torso.
 */
export function pickSegment(world: SimWorld, id: string, role: SegmentRole, toward: Vec2): string {
  const r = world.ragdoll(id);
  for (const candidate of [role, ...(ROLE_FALLBACK[role] ?? [])]) {
    const segs = r.segments.filter((s) => s.role === candidate);
    if (segs.length === 0) continue;
    let best = segs[0]!;
    let bestD = Infinity;
    for (const s of segs) {
      const t = world.segmentTransform(id, s.id);
      const d = Math.hypot(t.x - toward.x, t.y - toward.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best.id;
  }
  return r.segments[r.torsoIndex]!.id;
}

/** Point the target is aimed at; for a self-targeted Move, a point 3 m ahead of the actor. */
export function aimPoint(world: SimWorld, actorId: string, targetId: string): Vec2 {
  const p = torsoPosition(world, targetId);
  if (targetId !== actorId) return p;
  return { x: p.x + 3 * world.ragdoll(actorId).facing, y: p.y };
}

/** Highest point of a character's segment centres. */
export function topY(world: SimWorld, id: string): number {
  let y = -Infinity;
  for (const s of world.ragdoll(id).segments) y = Math.max(y, world.segmentTransform(id, s.id).y);
  return y;
}

/** Mass (kg) of one character segment. */
export function segmentMass(world: SimWorld, id: string, segmentId: string): number {
  return world.world.getRigidBody(world.segmentBodyHandle(id, segmentId)).mass();
}

/**
 * Launch angle (radians above horizontal, in the direction of travel) that lands a projectile of
 * `speed` on a point `dx` ahead (dx > 0) and `dy` above, using the lower arc. Null when out of reach.
 */
export function ballisticAngle(dx: number, dy: number, speed: number, g: number): number | null {
  if (g <= 1e-9) return Math.atan2(dy, dx);
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0) return null;
  return Math.atan2(v2 - Math.sqrt(disc), g * dx);
}
