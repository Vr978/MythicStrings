// Ragdoll construction and per-step control for one Puppet_Character (design: "Physics_Engine wrapper").
// One dynamic body per segment, revolute joints with limits enabled, PD motors toward the rest pose,
// a torso-uprighting torque, and a post-step joint-limit correction (Req 2.1, 2.3, 2.4, 2.5, 2.8).
import type RAPIER_NS from '@dimforge/rapier2d-deterministic-compat';
import type { RevoluteImpulseJoint, World } from '@dimforge/rapier2d-deterministic-compat';
import { PHYSICS_DT } from '../core/config';
import type { RigSpec, SegmentRole, Vec2 } from '../core/scenario/types';

type Rapier = typeof RAPIER_NS;

/** +1 faces +x (the rig's native direction), -1 is the rig mirrored about its vertical axis. */
export type Facing = 1 | -1;

/** Overshoot past a joint limit that triggers the post-step correction (Req 2.4). */
export const LIMIT_CORRECTION_THRESHOLD_RAD = (1 * Math.PI) / 180;
/** Fraction of the remaining range a fast joint may cover in one step when heading into a limit. */
const LIMIT_APPROACH_FRACTION = 0.7;

/** PD gains of the standing joint motors (acceleration-based, so independent of segment mass). */
export const MOTOR_STIFFNESS = 1200;
export const MOTOR_DAMPING = 2 * Math.sqrt(MOTOR_STIFFNESS);
/** Motor force budget while enabled (effectively unlimited for puppets of about 1 kg). */
export const MOTOR_MAX_FORCE = 1e6;
/** Gains of the torso-uprighting controller, in angular acceleration per radian and per rad/s. */
export const UPRIGHT_KP = 50;
export const UPRIGHT_KD = 10;

const SEGMENT_FRICTION = 0.8;
const FOOT_FRICTION = 1.5;

export interface RagdollSegment {
  id: string;
  role: SegmentRole;
  isFoot: boolean;
  bodyHandle: number;
  colliderHandle: number;
}

export interface RagdollJoint {
  parent: string;
  child: string;
  parentIndex: number;
  childIndex: number;
  handle: number;
  /** Limits in world orientation (already mirrored for facing -1). */
  lowerRad: number;
  upperRad: number;
}

/** Serializable description of a built ragdoll. Handles stay valid across snapshot/restore. */
export interface RagdollMeta {
  facing: Facing;
  originX: number;
  floorY: number;
  totalMass: number;
  torsoIndex: number;
  segments: RagdollSegment[];
  joints: RagdollJoint[];
}

export interface JointAngle {
  parent: string;
  child: string;
  /** Child rotation relative to parent, wrapped into the 2*pi window centred on the joint's range. */
  angle: number;
  lowerRad: number;
  upperRad: number;
}

export interface BuildRagdollOptions {
  originX: number;
  floorY: number;
  facing: Facing;
  /** Rapier InteractionGroups value for every segment collider. */
  collisionGroups: number;
  activeEvents: number;
}

/** Wraps an angle to (-pi, pi]. */
export function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  let r = a % twoPi;
  if (r <= -Math.PI) r += twoPi;
  else if (r > Math.PI) r -= twoPi;
  return r;
}

/**
 * Joint angle wrapped into the 2*pi window centred on the middle of the joint's range, so the wrap
 * point sits in the forbidden zone, as far as possible from both limits.
 */
export function relativeAngle(raw: number, limits: { lowerRad: number; upperRad: number }): number {
  const mid = (limits.lowerRad + limits.upperRad) / 2;
  return mid + wrapAngle(raw - mid);
}

function mirror(p: Vec2, facing: Facing): Vec2 {
  return { x: p.x * facing, y: p.y };
}

/**
 * Every segment gets extra rotational inertia up to this fraction of the largest segment inertia.
 * Thin limbs are otherwise about 50 times less inert than the torso, and at that ratio Rapier's joint
 * limits give way when the torso rests on a limb. Mass and centre of mass are unchanged.
 */
export const MIN_INERTIA_FRACTION = 0.5;

/**
 * Builds the ragdoll in canonical order: bodies and colliders by segment index, then joints by index.
 * Bodies start at rotation 0 so each joint's rest angle is 0.
 */
export function buildRagdoll(R: Rapier, world: World, rig: RigSpec, opts: BuildRagdollOptions): RagdollMeta {
  const { originX, floorY, facing } = opts;
  const indexById = new Map<string, number>();
  const segments: RagdollSegment[] = [];
  let totalMass = 0;
  const inertias: number[] = [];

  rig.segments.forEach((s, i) => {
    indexById.set(s.id, i);
    const rest = mirror(s.restPosition, facing);
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(originX + rest.x, floorY + rest.y).setRotation(0),
    );
    const pts = new Float32Array(s.outline.length * 2);
    s.outline.forEach((p, k) => {
      pts[2 * k] = p.x * facing;
      pts[2 * k + 1] = p.y;
    });
    let desc = R.ColliderDesc.convexHull(pts);
    if (!desc) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of s.outline) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      desc = R.ColliderDesc.cuboid(Math.max((maxX - minX) / 2, 0.01), Math.max((maxY - minY) / 2, 0.01));
    }
    const isFoot = s.isFoot === true;
    desc
      .setDensity(s.density)
      .setFriction(isFoot ? FOOT_FRICTION : SEGMENT_FRICTION)
      .setCollisionGroups(opts.collisionGroups)
      .setActiveEvents(opts.activeEvents)
      .setContactForceEventThreshold(0);
    const collider = world.createCollider(desc, body);
    totalMass += body.mass();
    inertias.push(body.principalInertia());
    segments.push({ id: s.id, role: s.role, isFoot, bodyHandle: body.handle, colliderHandle: collider.handle });
  });

  const maxI = Math.max(...inertias);
  segments.forEach((seg, i) => {
    const extra = MIN_INERTIA_FRACTION * maxI - inertias[i]!;
    if (extra > 0) world.getRigidBody(seg.bodyHandle).setAdditionalMassProperties(0, { x: 0, y: 0 }, extra, true);
  });

  const joints: RagdollJoint[] = [];
  for (const j of rig.joints) {
    const pi = indexById.get(j.parent);
    const ci = indexById.get(j.child);
    if (pi === undefined || ci === undefined) continue; // validated rigs never hit this
    const ps = rig.segments[pi]!;
    const cs = rig.segments[ci]!;
    const anchor = mirror(j.anchor, facing);
    const pr = mirror(ps.restPosition, facing);
    const cr = mirror(cs.restPosition, facing);
    const data = R.JointData.revolute({ x: anchor.x - pr.x, y: anchor.y - pr.y }, { x: anchor.x - cr.x, y: anchor.y - cr.y });
    const parentBody = world.getRigidBody(segments[pi]!.bodyHandle);
    const childBody = world.getRigidBody(segments[ci]!.bodyHandle);
    const joint = world.createImpulseJoint(data, parentBody, childBody, true) as RevoluteImpulseJoint;
    // Mirroring reverses the rotation sense, so [lo, hi] becomes [-hi, -lo].
    const lowerRad = facing === 1 ? j.lowerRad : -j.upperRad;
    const upperRad = facing === 1 ? j.upperRad : -j.lowerRad;
    joint.setLimits(lowerRad, upperRad);
    joint.setContactsEnabled(false);
    joint.configureMotorModel(R.MotorModel.AccelerationBased);
    joints.push({ parent: j.parent, child: j.child, parentIndex: pi, childIndex: ci, handle: joint.handle, lowerRad, upperRad });
  }

  const torsoIndex = Math.max(0, segments.findIndex((s) => s.role === 'torso'));
  return { facing, originX, floorY, totalMass, torsoIndex, segments, joints };
}

/** Enables PD motors toward the rest angle of each joint, clamped into the joint's limits, or turns them off. */
export function setJointMotors(world: World, meta: RagdollMeta, enabled: boolean): void {
  for (const j of meta.joints) {
    const joint = world.getImpulseJoint(j.handle) as RevoluteImpulseJoint;
    const target = Math.min(Math.max(0, j.lowerRad), j.upperRad);
    // Zero gains alone make Rapier treat the motor as a rigid velocity lock, so a released motor
    // also gets a zero force budget.
    if (enabled) {
      joint.setMotorMaxForce(MOTOR_MAX_FORCE);
      joint.configureMotorPosition(target, MOTOR_STIFFNESS, MOTOR_DAMPING);
    } else {
      joint.setMotorMaxForce(0);
      joint.configureMotorPosition(target, 0, 0);
    }
  }
}

/**
 * Applies one step of torso-uprighting torque toward a vertical torso. The torque acts on the whole
 * puppet (like the puppeteer's rod), as an equal angular velocity change about the puppet's centre of mass.
 */
export function applyUprightTorque(world: World, meta: RagdollMeta, dt: number = PHYSICS_DT): void {
  const seg = meta.segments[meta.torsoIndex];
  if (!seg) return;
  const torso = world.getRigidBody(seg.bodyHandle);
  const theta = wrapAngle(torso.rotation());
  // Angular velocity change for the whole puppet, as if rotated rigidly about its centre of mass by the
  // puppeteer's rod. Spreading it over all segments keeps the controller stable for a light torso.
  const dOmega = (-UPRIGHT_KP * theta - UPRIGHT_KD * torso.angvel()) * PHYSICS_DT;
  const bodies = meta.segments.map((s) => world.getRigidBody(s.bodyHandle));
  let m = 0, cx = 0, cy = 0;
  for (const b of bodies) {
    const bm = b.mass();
    const c = b.worldCom();
    m += bm; cx += bm * c.x; cy += bm * c.y;
  }
  if (m <= 0) return;
  cx /= m; cy /= m;
  for (const b of bodies) {
    const c = b.worldCom();
    const v = b.linvel();
    // v += dOmega x r, with r from the puppet's centre of mass.
    b.setLinvel({ x: v.x - dOmega * (c.y - cy), y: v.y + dOmega * (c.x - cx) }, true);
    b.setAngvel(b.angvel() + dOmega, true);
  }
}

export function jointAngles(world: World, meta: RagdollMeta): JointAngle[] {
  return meta.joints.map((j) => {
    const p = world.getRigidBody(meta.segments[j.parentIndex]!.bodyHandle);
    const c = world.getRigidBody(meta.segments[j.childIndex]!.bodyHandle);
    return {
      parent: j.parent,
      child: j.child,
      angle: relativeAngle(c.rotation() - p.rotation(), j),
      lowerRad: j.lowerRad,
      upperRad: j.upperRad,
    };
  });
}

/**
 * Joint-limit check (Req 2.4, 2.8), run after each step and again before the next one: when a joint
 * angle is, or would be after one more step, past its limit by more than `thresholdRad` (1 degree by
 * default), sets the child's angular velocity so the next step brings the joint back toward the limit.
 * The pre-step pass uses a threshold of 0 so fresh impulses cannot carry a joint past its limit; a
 * joint still inside its range is aimed short of the limit because the solver adds some overshoot.
 * Only body velocities change; collider transforms are never touched.
 */
export function enforceJointLimits(
  world: World,
  meta: RagdollMeta,
  dt: number = PHYSICS_DT,
  thresholdRad = LIMIT_CORRECTION_THRESHOLD_RAD,
): void {
  for (const j of meta.joints) {
    const p = world.getRigidBody(meta.segments[j.parentIndex]!.bodyHandle);
    const c = world.getRigidBody(meta.segments[j.childIndex]!.bodyHandle);
    const angle = relativeAngle(c.rotation() - p.rotation(), j);
    const rel = c.angvel() - p.angvel();
    // Angle the joint would reach after one more step at the current relative velocity.
    const predicted = angle + rel * dt;
    let target: number | null = null;
    if (predicted > j.upperRad + thresholdRad) {
      const f = angle <= j.upperRad ? LIMIT_APPROACH_FRACTION : 1;
      target = (f * (j.upperRad - angle)) / dt;
    } else if (predicted < j.lowerRad - thresholdRad) {
      const f = angle >= j.lowerRad ? LIMIT_APPROACH_FRACTION : 1;
      target = (f * (j.lowerRad - angle)) / dt;
    }
    if (target === null) continue;
    // Split the relative velocity change between both bodies by inertia, conserving angular momentum,
    // so a child pinned against the floor can still be corrected by turning the parent.
    const ip = p.effectiveAngularInertia();
    const ic = c.effectiveAngularInertia();
    const delta = target - rel;
    const sum = ip + ic;
    const wc = sum > 0 ? ip / sum : 1;
    c.setAngvel(c.angvel() + delta * wc, true);
    p.setAngvel(p.angvel() - delta * (1 - wc), true);
  }
}
