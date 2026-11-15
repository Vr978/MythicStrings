// SimWorld: the deterministic Rapier2D world holding the Stage, the ragdoll Puppet_Characters,
// and effect bodies spawned by Move_Primitives (design: "Physics_Engine wrapper").
//
// Determinism rules (Req 11.10): fixed timestep, canonical creation order (stage, then characters by
// Scenario order with segments by index, then effects by spawn order), randomness only from the seeded
// pure-rand xoroshiro128+ generator, no Math.random or wall-clock reads, and no collider transform
// mutation after creation.
//
// The Rapier WASM module must be initialized first: `await loadRapier()` (or `SimWorld.init()`).
import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { EventQueue, World } from '@dimforge/rapier2d-deterministic-compat';
import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64';
import { xoroshiro128plus, xoroshiro128plusFromState } from 'pure-rand/generator/xoroshiro128plus';
import type { JumpableRandomGenerator } from 'pure-rand/types/JumpableRandomGenerator';
import { PHYSICS_DT } from '../core/config';
import type { RigSpec, StageSpec, Vec2 } from '../core/scenario/types';
import {
  applyUprightTorque,
  buildRagdoll,
  enforceJointLimits,
  jointAngles as ragdollJointAngles,
  setJointMotors,
  type Facing,
  type JointAngle,
  type RagdollMeta,
} from './ragdoll';
import { loadRapier } from './rapier';

export type { Facing, JointAngle } from './ragdoll';

export const GRAVITY_Y = -9.81;
/** Horizontal spacing between neighbouring characters in the default layout. */
export const CHARACTER_SPACING_M = 3;
/** Rapier supports 16 membership bits; bits 0..13 are characters, 14 effects, 15 the stage. */
export const MAX_CHARACTERS = 14;
const EFFECT_GROUP_BIT = 14;
const STAGE_GROUP_BIT = 15;
const ALL_GROUPS = 0xffff;
/** Solver iterations per substep. With 2 substeps this keeps joint limits within tolerance under strong impulses. */
export const SOLVER_ITERATIONS = 8;
/** Physics substeps per fixed 1/60 s step. */
export const SUBSTEPS = 2;
/** Angular velocity added to the torso when motors are released, tipping it backward. */
const COLLAPSE_TIP_RAD_PER_S = 1;
const FLOOR_HALF_THICKNESS = 0.5;
const SNAPSHOT_MAGIC = 0x4d534e31; // "MSN1"

/** Character input to the sim. A PuppetCharacter is assignable to this type. */
export interface CharacterRuntime {
  id: string;
  rig: RigSpec;
  /** Floor x of the rig origin. Defaults to an even layout centred on x = 0. */
  x?: number;
  /** Defaults to facing the Stage centre (left characters face +x). */
  facing?: Facing;
}

export type EffectKind = 'arrow' | 'clone' | 'boulder' | 'mace' | 'object' | (string & {});

export type EffectShape =
  | { type: 'ball'; radius: number }
  | { type: 'cuboid'; hx: number; hy: number }
  | { type: 'polygon'; points: Vec2[] };

export interface EffectSpawn {
  kind: EffectKind;
  shape: EffectShape;
  position: Vec2;
  angle?: number;
  linvel?: Vec2;
  angvel?: number;
  density?: number;
  friction?: number;
  restitution?: number;
  gravityScale?: number;
  /** Continuous collision detection, useful for fast projectiles. */
  ccd?: boolean;
  /** Removed automatically after this many steps; omitted means it persists. */
  lifetimeSteps?: number;
  /** Primitive-specific tag (e.g. which character spawned it). */
  ownerCharacterId?: string;
}

export interface EffectInfo {
  id: number;
  kind: EffectKind;
  bodyHandle: number;
  colliderHandle: number;
  /** Step count at which the effect is removed, or null. */
  expiresAtStep: number | null;
  ownerCharacterId: string | null;
}

export type ColliderOwner =
  | { type: 'segment'; characterId: string; segmentId: string }
  | { type: 'effect'; effectId: number; kind: EffectKind }
  | { type: 'stage' };

export interface ContactRecord {
  collider1: number;
  collider2: number;
  owner1: ColliderOwner;
  owner2: ColliderOwner;
  /** Contact impulse for the step: total force magnitude times dt (N·s). */
  impulse: number;
}

export interface CharacterHit {
  characterId: string;
  contactCount: number;
  totalImpulse: number;
}

export interface StepReport {
  /** Step index (0-based) that this report describes. */
  step: number;
  /** All contacts of the step that involve at least one non-stage collider. */
  contacts: ContactRecord[];
  /** Hits on characters in this step from effects or other characters (no self or stage contacts). */
  hits: CharacterHit[];
}

export interface BodyTransform {
  x: number;
  y: number;
  angle: number;
}

export interface WorldTransforms {
  characters: { id: string; segments: ({ id: string } & BodyTransform)[] }[];
  effects: ({ id: number; kind: EffectKind } & BodyTransform)[];
}

interface CharacterState {
  id: string;
  ragdoll: RagdollMeta;
  motorsEnabled: boolean;
  defeated: boolean;
  hits: { contactCount: number; totalImpulse: number };
}

interface SnapshotMeta {
  v: 1;
  stepCount: number;
  rngState: number[];
  nextEffectId: number;
  stageColliders: number[];
  characters: CharacterState[];
  effects: EffectInfo[];
}

/** Seeded PRNG handed to Move_Primitives. The only source of randomness in the sim. */
export class SimRng {
  constructor(private gen: JumpableRandomGenerator) {}
  static fromSeed(seed: number): SimRng {
    return new SimRng(xoroshiro128plus(seed | 0));
  }
  static fromState(state: readonly number[]): SimRng {
    return new SimRng(xoroshiro128plusFromState(state));
  }
  /** Uniform in [0, 1). */
  nextFloat(): number {
    return uniformFloat64(this.gen);
  }
  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.nextFloat();
  }
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }
  state(): number[] {
    return [...this.gen.getState()];
  }
}

const groups = (membershipBit: number, filter: number): number => (((1 << membershipBit) & 0xffff) << 16) | (filter & 0xffff);

function defaultLayout(count: number, index: number): { x: number; facing: Facing } {
  const x = (index - (count - 1) / 2) * CHARACTER_SPACING_M;
  return { x, facing: x <= 0 ? 1 : -1 };
}

export class SimWorld {
  private readonly owners = new Map<number, ColliderOwner>();
  private readonly byId = new Map<string, CharacterState>();
  private readonly events: EventQueue;

  private constructor(
    readonly world: World,
    private readonly characters: CharacterState[],
    private effectList: EffectInfo[],
    private readonly stageColliders: number[],
    readonly rng: SimRng,
    private stepCount: number,
    private nextEffectId: number,
  ) {
    world.timestep = PHYSICS_DT / SUBSTEPS;
    world.numSolverIterations = SOLVER_ITERATIONS;
    this.events = new RAPIER.EventQueue(true);
    for (const h of stageColliders) this.owners.set(h, { type: 'stage' });
    for (const c of characters) {
      this.byId.set(c.id, c);
      for (const s of c.ragdoll.segments) this.owners.set(s.colliderHandle, { type: 'segment', characterId: c.id, segmentId: s.id });
    }
    for (const e of effectList) this.owners.set(e.colliderHandle, { type: 'effect', effectId: e.id, kind: e.kind });
  }

  /** Initializes the Rapier WASM module. Must resolve before `create` or `fromSnapshot`. */
  static init(): Promise<void> {
    return loadRapier().then(() => undefined);
  }

  static create(stage: StageSpec, characters: CharacterRuntime[], seed: number): SimWorld {
    if (characters.length > MAX_CHARACTERS) throw new Error(`at most ${MAX_CHARACTERS} characters are supported`);
    const R = RAPIER;
    const world = new R.World({ x: 0, y: GRAVITY_Y });
    const events = R.ActiveEvents.CONTACT_FORCE_EVENTS;

    // Stage: floor, then props in order.
    const stageColliders: number[] = [];
    const stageGroups = groups(STAGE_GROUP_BIT, ALL_GROUPS);
    const floorHalfWidth = Math.max(stage.width, 8) * 2;
    const floor = world.createCollider(
      R.ColliderDesc.cuboid(floorHalfWidth, FLOOR_HALF_THICKNESS)
        .setTranslation(0, stage.floorY - FLOOR_HALF_THICKNESS)
        .setFriction(1)
        .setCollisionGroups(stageGroups),
    );
    stageColliders.push(floor.handle);
    for (const prop of stage.props) {
      const pts = new Float32Array(prop.outline.flatMap((p) => [p.x, p.y]));
      const desc = R.ColliderDesc.convexHull(pts);
      if (!desc) continue;
      const c = world.createCollider(
        desc.setTranslation(prop.position.x, prop.position.y).setFriction(1).setCollisionGroups(stageGroups),
      );
      stageColliders.push(c.handle);
    }

    const states: CharacterState[] = characters.map((ch, i) => {
      const layout = defaultLayout(characters.length, i);
      const ragdoll = buildRagdoll(R, world, ch.rig, {
        originX: ch.x ?? layout.x,
        floorY: stage.floorY,
        facing: ch.facing ?? layout.facing,
        collisionGroups: groups(i, ALL_GROUPS & ~(1 << i)), // no self-collision
        activeEvents: events,
      });
      setJointMotors(world, ragdoll, true);
      return { id: ch.id, ragdoll, motorsEnabled: true, defeated: false, hits: { contactCount: 0, totalImpulse: 0 } };
    });
    return new SimWorld(world, states, [], stageColliders, SimRng.fromSeed(seed), 0, 0);
  }

  /** Restores a world from `snapshot()` bytes, including character maps, effects, RNG, and flags. */
  static fromSnapshot(bytes: Uint8Array): SimWorld {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 8 || view.getUint32(0) !== SNAPSHOT_MAGIC) throw new Error('not a SimWorld snapshot');
    const metaLen = view.getUint32(4);
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + metaLen))) as SnapshotMeta;
    if (meta.v !== 1) throw new Error(`unsupported snapshot version ${String(meta.v)}`);
    const world = RAPIER.World.restoreSnapshot(bytes.slice(8 + metaLen));
    return new SimWorld(
      world,
      meta.characters,
      meta.effects,
      meta.stageColliders,
      SimRng.fromState(meta.rngState),
      meta.stepCount,
      meta.nextEffectId,
    );
  }

  /** Serializes metadata (JSON) followed by the Rapier world snapshot. */
  snapshot(): Uint8Array {
    const meta: SnapshotMeta = {
      v: 1,
      stepCount: this.stepCount,
      rngState: this.rng.state(),
      nextEffectId: this.nextEffectId,
      stageColliders: this.stageColliders,
      characters: this.characters,
      effects: this.effectList,
    };
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
    const physics = this.world.takeSnapshot();
    const out = new Uint8Array(8 + metaBytes.byteLength + physics.byteLength);
    const view = new DataView(out.buffer);
    view.setUint32(0, SNAPSHOT_MAGIC);
    view.setUint32(4, metaBytes.byteLength);
    out.set(metaBytes, 8);
    out.set(physics, 8 + metaBytes.byteLength);
    return out;
  }

  /** Advances the simulation by one fixed step of 1/60 s. */
  step(): StepReport {
    const contacts: ContactRecord[] = [];
    const stepHits = new Map<string, CharacterHit>();
    const addHit = (characterId: string, impulse: number): void => {
      let h = stepHits.get(characterId);
      if (!h) stepHits.set(characterId, (h = { characterId, contactCount: 0, totalImpulse: 0 }));
      h.contactCount += 1;
      h.totalImpulse += impulse;
    };
    const dt = PHYSICS_DT / SUBSTEPS;
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      for (const c of this.characters) {
        if (c.motorsEnabled && !c.defeated) applyUprightTorque(this.world, c.ragdoll, dt);
        // Catches velocities from impulses applied since the last step before they push past a limit.
        enforceJointLimits(this.world, c.ragdoll, dt, 0);
      }
      this.world.step(this.events);
      this.events.drainContactForceEvents((ev) => {
        const collider1 = ev.collider1();
        const collider2 = ev.collider2();
        const owner1 = this.owners.get(collider1);
        const owner2 = this.owners.get(collider2);
        if (!owner1 || !owner2) return;
        if (owner1.type === 'stage' && owner2.type === 'stage') return;
        const impulse = ev.totalForceMagnitude() * dt;
        contacts.push({ collider1, collider2, owner1, owner2, impulse });
        if (owner1.type === 'stage' || owner2.type === 'stage') return; // floor and prop contacts are not hits
        if (owner1.type === 'segment' && owner2.type === 'segment' && owner1.characterId === owner2.characterId) return;
        if (owner1.type === 'segment') addHit(owner1.characterId, impulse);
        if (owner2.type === 'segment') addHit(owner2.characterId, impulse);
      });
      for (const c of this.characters) enforceJointLimits(this.world, c.ragdoll, dt);
    }

    const step = this.stepCount;
    this.stepCount += 1;
    const expired = this.effectList.filter((e) => e.expiresAtStep !== null && e.expiresAtStep <= this.stepCount);
    for (const e of expired) this.despawnEffect(e.id);

    const hits: CharacterHit[] = [];
    for (const c of this.characters) {
      const h = stepHits.get(c.id);
      if (!h) continue;
      c.hits.contactCount += h.contactCount;
      c.hits.totalImpulse += h.totalImpulse;
      hits.push(h);
    }
    return { step, contacts, hits };
  }

  get steps(): number {
    return this.stepCount;
  }

  characterIds(): string[] {
    return this.characters.map((c) => c.id);
  }

  private char(id: string): CharacterState {
    const c = this.byId.get(id);
    if (!c) throw new Error(`unknown character ${id}`);
    return c;
  }

  jointAngles(characterId: string): JointAngle[] {
    return ragdollJointAngles(this.world, this.char(characterId).ragdoll);
  }

  /** Turns the standing controller on or off. Has no effect on a defeated character (Req 2.7). */
  setStandingMotors(characterId: string, enabled: boolean): void {
    const c = this.char(characterId);
    if (c.defeated) return;
    c.motorsEnabled = enabled;
    setJointMotors(this.world, c.ragdoll, enabled);
  }

  /** Releases all motors and marks the character defeated until the Battle ends (Req 2.5, 2.7). */
  releaseMotors(characterId: string): void {
    const c = this.char(characterId);
    const wasDefeated = c.defeated;
    c.defeated = true;
    c.motorsEnabled = false;
    setJointMotors(this.world, c.ragdoll, false);
    if (!wasDefeated) {
      // A limp puppet that is perfectly balanced would stay upright, so give the torso a small
      // deterministic backward tip to start the collapse under gravity (Req 2.5).
      const r = c.ragdoll;
      const torso = this.world.getRigidBody(r.segments[r.torsoIndex]!.bodyHandle);
      torso.setAngvel(torso.angvel() + COLLAPSE_TIP_RAD_PER_S * r.facing, true);
    }
  }

  isDefeated(characterId: string): boolean {
    return this.char(characterId).defeated;
  }

  motorsEnabled(characterId: string): boolean {
    return this.char(characterId).motorsEnabled;
  }

  /** Ragdoll description: segment ids, body and collider handles, joints and limits. */
  ragdoll(characterId: string): Readonly<RagdollMeta> {
    return this.char(characterId).ragdoll;
  }

  /** Rapier body handle of a character segment. */
  segmentBodyHandle(characterId: string, segmentId: string): number {
    const s = this.char(characterId).ragdoll.segments.find((seg) => seg.id === segmentId);
    if (!s) throw new Error(`unknown segment ${segmentId} on ${characterId}`);
    return s.bodyHandle;
  }

  /** Applies a linear impulse (N·s) at the centre of mass of one character segment. */
  applySegmentImpulse(characterId: string, segmentId: string, impulse: Vec2): void {
    this.world.getRigidBody(this.segmentBodyHandle(characterId, segmentId)).applyImpulse(impulse, true);
  }

  segmentTransform(characterId: string, segmentId: string): BodyTransform {
    return this.bodyTransform(this.segmentBodyHandle(characterId, segmentId));
  }

  /** Torso angle from vertical, wrapped to (-pi, pi]. */
  torsoAngle(characterId: string): number {
    const r = this.char(characterId).ragdoll;
    const seg = r.segments[r.torsoIndex]!;
    const a = this.world.getRigidBody(seg.bodyHandle).rotation();
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  /** Accumulated hits since creation or the last `resetHits`, one entry per character in Scenario order. */
  hitTotals(): CharacterHit[] {
    return this.characters.map((c) => ({ characterId: c.id, ...c.hits }));
  }

  resetHits(): void {
    for (const c of this.characters) c.hits = { contactCount: 0, totalImpulse: 0 };
  }

  colliderOwner(handle: number): ColliderOwner | undefined {
    return this.owners.get(handle);
  }

  /** Spawns one effect body. Call in canonical order (primitive index, then spawn index). */
  spawnEffect(spec: EffectSpawn): EffectInfo {
    const R = RAPIER;
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(spec.position.x, spec.position.y)
      .setRotation(spec.angle ?? 0)
      .setLinvel(spec.linvel?.x ?? 0, spec.linvel?.y ?? 0)
      .setAngvel(spec.angvel ?? 0)
      .setGravityScale(spec.gravityScale ?? 1)
      .setCcdEnabled(spec.ccd ?? false);
    const body = this.world.createRigidBody(bodyDesc);
    let desc: ReturnType<typeof R.ColliderDesc.ball> | null;
    switch (spec.shape.type) {
      case 'ball':
        desc = R.ColliderDesc.ball(spec.shape.radius);
        break;
      case 'cuboid':
        desc = R.ColliderDesc.cuboid(spec.shape.hx, spec.shape.hy);
        break;
      case 'polygon':
        desc = R.ColliderDesc.convexHull(new Float32Array(spec.shape.points.flatMap((p) => [p.x, p.y])));
        break;
    }
    if (!desc) {
      this.world.removeRigidBody(body);
      throw new Error('invalid effect shape');
    }
    desc
      .setDensity(spec.density ?? 1)
      .setFriction(spec.friction ?? 0.5)
      .setRestitution(spec.restitution ?? 0.1)
      .setCollisionGroups(groups(EFFECT_GROUP_BIT, ALL_GROUPS))
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0);
    const collider = this.world.createCollider(desc, body);
    const info: EffectInfo = {
      id: this.nextEffectId++,
      kind: spec.kind,
      bodyHandle: body.handle,
      colliderHandle: collider.handle,
      expiresAtStep: spec.lifetimeSteps === undefined ? null : this.stepCount + Math.max(1, Math.floor(spec.lifetimeSteps)),
      ownerCharacterId: spec.ownerCharacterId ?? null,
    };
    this.effectList.push(info);
    this.owners.set(info.colliderHandle, { type: 'effect', effectId: info.id, kind: info.kind });
    return info;
  }

  despawnEffect(effectId: number): void {
    const idx = this.effectList.findIndex((e) => e.id === effectId);
    if (idx < 0) return;
    const e = this.effectList[idx]!;
    this.effectList.splice(idx, 1);
    this.owners.delete(e.colliderHandle);
    this.world.removeRigidBody(this.world.getRigidBody(e.bodyHandle));
  }

  effects(): readonly EffectInfo[] {
    return this.effectList;
  }

  effectCount(kind?: EffectKind): number {
    return kind === undefined ? this.effectList.length : this.effectList.filter((e) => e.kind === kind).length;
  }

  /** Total dynamic bodies: all character segments plus effects. */
  bodyCount(): number {
    return this.characters.reduce((n, c) => n + c.ragdoll.segments.length, 0) + this.effectList.length;
  }

  effectBody(effectId: number) {
    const e = this.effectList.find((x) => x.id === effectId);
    if (!e) throw new Error(`unknown effect ${effectId}`);
    return this.world.getRigidBody(e.bodyHandle);
  }

  private bodyTransform(handle: number): BodyTransform {
    const b = this.world.getRigidBody(handle);
    const t = b.translation();
    return { x: t.x, y: t.y, angle: b.rotation() };
  }

  /** Positions and angles of every character segment and effect body, for rendering. */
  transforms(): WorldTransforms {
    return {
      characters: this.characters.map((c) => ({
        id: c.id,
        segments: c.ragdoll.segments.map((s) => ({ id: s.id, ...this.bodyTransform(s.bodyHandle) })),
      })),
      effects: this.effectList.map((e) => ({ id: e.id, kind: e.kind, ...this.bodyTransform(e.bodyHandle) })),
    };
  }

  /** True when every dynamic body has finite position, angle, and velocities. */
  allFinite(): boolean {
    let ok = true;
    this.world.forEachRigidBody((b) => {
      if (!ok || b.isFixed()) return;
      const t = b.translation();
      const v = b.linvel();
      if (![t.x, t.y, b.rotation(), v.x, v.y, b.angvel()].every(Number.isFinite)) ok = false;
    });
    return ok;
  }

  free(): void {
    this.events.free();
    this.world.free();
  }
}
