// Default humanoid rig (Req 2.6) and rig validation/resolution.
// Rest pose is in character-local meters, y-up, origin on the floor between the feet.
// The puppet faces +x; each shin includes its foot, so shins are the foot segments.
import type { Result } from '../core/moveblock/types';
import { SEGMENT_ROLES, type JointSpec, type RigSpec, type SegmentSpec, type Vec2 } from '../core/scenario/types';

export const RIG_BODIES_MIN = 6;
export const RIG_BODIES_MAX = 20;

const rect = (w: number, h: number): Vec2[] => [
  { x: -w / 2, y: -h / 2 },
  { x: w / 2, y: -h / 2 },
  { x: w / 2, y: h / 2 },
  { x: -w / 2, y: h / 2 },
];

/** Octagon approximating a circle, for the head. */
const octagon = (r: number): Vec2[] =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 4) * i + Math.PI / 8;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });

/** Shin of length 0.45 with the foot extending toward +x at its bottom. */
const shinWithFoot: Vec2[] = [
  { x: -0.06, y: -0.225 },
  { x: 0.16, y: -0.225 },
  { x: 0.16, y: -0.17 },
  { x: 0.06, y: -0.15 },
  { x: 0.06, y: 0.225 },
  { x: -0.06, y: 0.225 },
];

const seg = (
  id: string,
  role: SegmentSpec['role'],
  outline: Vec2[],
  restPosition: Vec2,
  density: number,
  isFoot = false,
): SegmentSpec => ({ id, role, outline, restPosition, density, ...(isFoot ? { isFoot: true } : {}) });

const joint = (parent: string, child: string, anchor: Vec2, lowerRad: number, upperRad: number): JointSpec => ({
  parent,
  child,
  anchor,
  lowerRad,
  upperRad,
});

export const DEFAULT_HUMANOID_RIG: RigSpec = Object.freeze({
  segments: [
    seg('torso', 'torso', rect(0.36, 0.6), { x: 0, y: 1.2 }, 1.2),
    seg('head', 'head', octagon(0.12), { x: 0, y: 1.63 }, 1.0),
    seg('upper_arm_l', 'upper_arm', rect(0.1, 0.3), { x: 0.22, y: 1.3 }, 1.0),
    seg('forearm_l', 'forearm', rect(0.09, 0.3), { x: 0.22, y: 1.0 }, 1.0),
    seg('upper_arm_r', 'upper_arm', rect(0.1, 0.3), { x: -0.22, y: 1.3 }, 1.0),
    seg('forearm_r', 'forearm', rect(0.09, 0.3), { x: -0.22, y: 1.0 }, 1.0),
    seg('thigh_l', 'thigh', rect(0.14, 0.45), { x: 0.1, y: 0.675 }, 1.1),
    seg('shin_l', 'shin', shinWithFoot, { x: 0.1, y: 0.225 }, 1.1, true),
    seg('thigh_r', 'thigh', rect(0.14, 0.45), { x: -0.1, y: 0.675 }, 1.1),
    seg('shin_r', 'shin', shinWithFoot, { x: -0.1, y: 0.225 }, 1.1, true),
  ],
  joints: [
    joint('torso', 'head', { x: 0, y: 1.5 }, -0.5, 0.5),
    joint('torso', 'upper_arm_l', { x: 0.22, y: 1.45 }, -2.8, 2.8),
    joint('upper_arm_l', 'forearm_l', { x: 0.22, y: 1.15 }, 0, 2.4),
    joint('torso', 'upper_arm_r', { x: -0.22, y: 1.45 }, -2.8, 2.8),
    joint('upper_arm_r', 'forearm_r', { x: -0.22, y: 1.15 }, 0, 2.4),
    joint('torso', 'thigh_l', { x: 0.1, y: 0.9 }, -1.6, 0.8),
    joint('thigh_l', 'shin_l', { x: 0.1, y: 0.45 }, -2.3, 0),
    joint('torso', 'thigh_r', { x: -0.1, y: 0.9 }, -1.6, 0.8),
    joint('thigh_r', 'shin_r', { x: -0.1, y: 0.45 }, -2.3, 0),
  ],
});

export interface RigError {
  /** e.g. `segments`, `joints[3].lowerRad`. */
  path: string;
  reason: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec2 = (v: unknown): v is Vec2 => isObj(v) && isFiniteNum(v.x) && isFiniteNum(v.y);
const fail = (path: string, reason: string): Result<never, RigError> => ({ ok: false, error: { path, reason } });

/**
 * Validates a Character_Agent rig: 6..20 segments with unique ids and well-formed geometry,
 * and joints that reference existing segments with finite limits where lowerRad <= upperRad.
 */
export function validateRig(rig: unknown): Result<RigSpec, RigError> {
  if (!isObj(rig)) return fail('', 'rig must be an object');
  const { segments, joints } = rig;
  if (!Array.isArray(segments)) return fail('segments', 'must be an array');
  if (segments.length < RIG_BODIES_MIN || segments.length > RIG_BODIES_MAX) {
    return fail('segments', `must have ${RIG_BODIES_MIN} to ${RIG_BODIES_MAX} rigid bodies`);
  }
  const ids = new Set<string>();
  for (let i = 0; i < segments.length; i++) {
    const s: unknown = segments[i];
    const p = `segments[${i}]`;
    if (!isObj(s)) return fail(p, 'must be an object');
    if (typeof s.id !== 'string' || s.id.length === 0) return fail(`${p}.id`, 'must be a non-empty string');
    if (ids.has(s.id)) return fail(`${p}.id`, 'duplicate segment id');
    ids.add(s.id);
    if (!(SEGMENT_ROLES as readonly unknown[]).includes(s.role)) return fail(`${p}.role`, 'unknown role');
    if (!Array.isArray(s.outline) || s.outline.length < 3 || !s.outline.every(isVec2)) {
      return fail(`${p}.outline`, 'must be a polygon of at least 3 finite points');
    }
    if (!isFiniteNum(s.density) || s.density <= 0) return fail(`${p}.density`, 'must be a positive number');
    if (!isVec2(s.restPosition)) return fail(`${p}.restPosition`, 'must be a finite point');
  }
  if (!Array.isArray(joints)) return fail('joints', 'must be an array');
  for (let i = 0; i < joints.length; i++) {
    const j: unknown = joints[i];
    const p = `joints[${i}]`;
    if (!isObj(j)) return fail(p, 'must be an object');
    if (typeof j.parent !== 'string' || !ids.has(j.parent)) return fail(`${p}.parent`, 'must name a segment');
    if (typeof j.child !== 'string' || !ids.has(j.child)) return fail(`${p}.child`, 'must name a segment');
    if (j.parent === j.child) return fail(`${p}.child`, 'must differ from parent');
    if (!isVec2(j.anchor)) return fail(`${p}.anchor`, 'must be a finite point');
    if (!isFiniteNum(j.lowerRad)) return fail(`${p}.lowerRad`, 'missing or non-finite angle limit');
    if (!isFiniteNum(j.upperRad)) return fail(`${p}.upperRad`, 'missing or non-finite angle limit');
    if (j.lowerRad > j.upperRad) return fail(`${p}.lowerRad`, 'lower limit is greater than upper limit');
  }
  return { ok: true, value: rig as unknown as RigSpec };
}

/** Returns the rig when valid, otherwise DEFAULT_HUMANOID_RIG (Req 2.6). */
export function resolveRig(rig: unknown): RigSpec {
  const r = validateRig(rig);
  return r.ok ? r.value : DEFAULT_HUMANOID_RIG;
}
