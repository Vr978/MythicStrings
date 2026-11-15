import { beforeAll, describe, expect, it } from 'vitest';
import { PHYSICS_HZ } from '../core/config';
import { createDefaultRegistry } from '../core/moveblock/primitiveSchemas';
import type { MoveBlock, PrimitiveInvocation } from '../core/moveblock/types';
import { ARJUN_VS_DURYODHAN, KURUKSHETRA_STAGE } from '../content/scenarios/arjunVsDuryodhan';
import { executeMoveBlock, PrimitiveError, type MoveExecution } from './execute';
import { checkImplementations, PRIMITIVE_IMPLEMENTATIONS } from './primitives';
import { SimWorld } from './world';

const ACTOR = 'arjun';
const TARGET = 'duryodhan';

const block = (...primitives: PrimitiveInvocation[]): MoveBlock => ({
  schemaVersion: 1,
  displayName: 'Test Move',
  description: 'A test move.',
  primitives,
  targets: { primary: 'selected_opponent', affects: 'primary_only' },
});

const VOLLEY = { primitive: 'projectile_volley', params: { count: 5, projectileShape: 'arrow', speed: 25, spreadDeg: 6, intervalMs: 100 } };
const CLONES_CHARGE = { primitive: 'spawn_clones', params: { count: 3, source: 'body', lifetimeMs: 3000, behavior: 'charge' } };
const CLONES_SURROUND = { primitive: 'spawn_clones', params: { count: 4, source: 'hair', lifetimeMs: 3000, behavior: 'surround' } };
const CLONES_MIRROR = { primitive: 'spawn_clones', params: { count: 2, source: 'shadow', lifetimeMs: 3000, behavior: 'mirror' } };
const IMPULSE = { primitive: 'apply_impulse', params: { segment: 'hand', magnitude: 3000, angleDeg: 10 } };
const BOULDER = { primitive: 'summon_object', params: { object: 'boulder', sizeScale: 1, dropHeight: 3 } };
const MACE = { primitive: 'summon_object', params: { object: 'mace', sizeScale: 1.5, dropHeight: 0 } };

const newWorld = (seed = 7): SimWorld => SimWorld.create(KURUKSHETRA_STAGE, ARJUN_VS_DURYODHAN.characters, seed);

/** Lets the puppets settle, then runs the block for `seconds` and returns hits during the Move. */
function run(b: MoveBlock, seconds = 4, seed = 11): { w: SimWorld; exec: MoveExecution; targetHits: number; actorHits: number } {
  const w = newWorld();
  for (let i = 0; i < 30; i++) w.step();
  w.resetHits();
  const exec = executeMoveBlock(w, b, ACTOR, TARGET, seed);
  for (let i = 0; i < seconds * PHYSICS_HZ; i++) exec.step();
  const totals = w.hitTotals();
  return {
    w,
    exec,
    targetHits: totals.find((h) => h.characterId === TARGET)!.contactCount,
    actorHits: totals.find((h) => h.characterId === ACTOR)!.contactCount,
  };
}

beforeAll(async () => {
  await SimWorld.init();
});

describe('primitive implementation map', () => {
  it('covers every schema in the default registry and nothing else', () => {
    expect(checkImplementations(createDefaultRegistry())).toEqual({ missing: [], unregistered: [] });
    expect([...PRIMITIVE_IMPLEMENTATIONS.keys()].sort()).toEqual(
      createDefaultRegistry().list().map((d) => d.name).sort(),
    );
  });
});

describe('each primitive hits the target in a 2-character world', () => {
  it.each([
    ['projectile_volley', VOLLEY],
    ['spawn_clones charge', CLONES_CHARGE],
    ['spawn_clones surround', CLONES_SURROUND],
    ['spawn_clones mirror', CLONES_MIRROR],
    ['apply_impulse', IMPULSE],
    ['summon_object boulder', BOULDER],
    ['summon_object mace', MACE],
  ])('%s', (_name, inv) => {
    const { w, targetHits } = run(block(inv));
    expect(targetHits).toBeGreaterThan(0);
    expect(w.allFinite()).toBe(true);
    w.free();
  });
});

describe('projectile_volley', () => {
  it('spawns exactly `count` projectiles, one every intervalMs', () => {
    const w = newWorld();
    const exec = executeMoveBlock(w, block({ ...VOLLEY, params: { ...VOLLEY.params, count: 7, intervalMs: 50 } }), ACTOR, TARGET, 3);
    const spawnSteps: number[] = [];
    for (let i = 0; i < 2 * PHYSICS_HZ; i++) {
      const before = exec.spawnCount;
      exec.step();
      if (exec.spawnCount > before) spawnSteps.push(i);
    }
    expect(exec.spawnCount).toBe(7);
    expect(exec.spawnedEffects.every((e) => e.kind === 'arrow' && e.ownerCharacterId === ACTOR)).toBe(true);
    expect(spawnSteps).toEqual([0, 3, 6, 9, 12, 15, 18]);
    w.free();
  });

  it('spawns all projectiles in the first step when intervalMs is 0', () => {
    const w = newWorld();
    const exec = executeMoveBlock(w, block({ ...VOLLEY, params: { ...VOLLEY.params, count: 12, intervalMs: 0 } }), ACTOR, TARGET, 3);
    exec.step();
    expect(w.effectCount('arrow')).toBe(12);
    expect(exec.pending).toBe(false);
    w.free();
  });
});

describe('apply_impulse', () => {
  it('pushes only the actor: target velocities are unchanged when the impulse is applied', () => {
    const w = newWorld();
    for (let i = 0; i < 30; i++) w.step();
    const vel = (id: string) =>
      w.ragdoll(id).segments.map((s) => w.world.getRigidBody(s.bodyHandle).linvel()).map((v) => [v.x, v.y]);
    const targetBefore = vel(TARGET);
    const actorBefore = vel(ACTOR);
    const exec = executeMoveBlock(w, block(IMPULSE), ACTOR, TARGET, 1);
    exec.beforeStep();
    expect(vel(TARGET)).toEqual(targetBefore);
    expect(vel(ACTOR)).not.toEqual(actorBefore);
    w.free();
  });
});

describe('executeMoveBlock', () => {
  it('rejects unregistered primitives before running anything', () => {
    const w = newWorld();
    for (const name of ['teleport', '__proto__', 'constructor']) {
      expect(() => executeMoveBlock(w, block(VOLLEY, { primitive: name, params: {} }), ACTOR, TARGET, 1)).toThrow(PrimitiveError);
    }
    expect(w.effectCount()).toBe(0);
    w.free();
  });

  it('rejects out-of-range parameters and unknown characters', () => {
    const w = newWorld();
    expect(() => executeMoveBlock(w, block({ ...VOLLEY, params: { ...VOLLEY.params, count: 101 } }), ACTOR, TARGET, 1)).toThrow(
      PrimitiveError,
    );
    expect(() => executeMoveBlock(w, block(VOLLEY), ACTOR, 'bhima', 1)).toThrow(PrimitiveError);
    w.free();
  });

  it('runs a combined block in block order and stays finite at maximum parameters', () => {
    const max = block(
      { primitive: 'apply_impulse', params: { segment: 'torso', magnitude: 5000, angleDeg: 180 } },
      { primitive: 'projectile_volley', params: { count: 100, projectileShape: 'spear', speed: 60, spreadDeg: 90, intervalMs: 0 } },
      { primitive: 'spawn_clones', params: { count: 8, source: 'hair', lifetimeMs: 6000, behavior: 'surround' } },
      { primitive: 'summon_object', params: { object: 'wall', sizeScale: 3, dropHeight: 10 } },
    );
    const { w, exec } = run(max, 3);
    expect(exec.spawnedEffects.map((e) => e.kind)).toEqual([...Array(100).fill('spear'), ...Array(8).fill('clone'), 'wall']);
    expect(w.allFinite()).toBe(true);
    w.free();
  });

  it('is deterministic: two runs from the same state and seed match exactly', () => {
    const b = block(IMPULSE, VOLLEY, CLONES_SURROUND, BOULDER);
    const a = run(b, 3, 42);
    const c = run(b, 3, 42);
    expect(c.w.hitTotals()).toEqual(a.w.hitTotals());
    expect(c.w.transforms()).toEqual(a.w.transforms());
    expect(c.w.snapshot()).toEqual(a.w.snapshot());
    a.w.free();
    c.w.free();
  });

  it('replays identically from a snapshot, as the validator and live client do', () => {
    const base = newWorld();
    for (let i = 0; i < 20; i++) base.step();
    const snap = base.snapshot();
    base.free();
    const play = () => {
      const w = SimWorld.fromSnapshot(snap);
      const exec = executeMoveBlock(w, block(VOLLEY, CLONES_CHARGE), ACTOR, TARGET, 9);
      for (let i = 0; i < 2 * PHYSICS_HZ; i++) exec.step();
      const out = { hits: w.hitTotals(), transforms: w.transforms() };
      w.free();
      return out;
    };
    expect(play()).toEqual(play());
  });
});
