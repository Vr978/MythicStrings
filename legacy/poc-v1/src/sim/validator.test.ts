import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_SIM_STEPS } from '../core/config';
import { createDefaultRegistry } from '../core/moveblock/primitiveSchemas';
import type { MoveBlock, PrimitiveInvocation } from '../core/moveblock/types';
import { ARJUN_VS_DURYODHAN, KURUKSHETRA_STAGE } from '../content/scenarios/arjunVsDuryodhan';
import { validateMoveBlock, validateWithClamp, type ValidationJob } from './validator';
import { SimWorld } from './world';

const ACTOR = 'arjun';
const TARGET = 'duryodhan';
const registry = createDefaultRegistry();
const realClock = () => performance.now();

const block = (...primitives: PrimitiveInvocation[]): MoveBlock => ({
  schemaVersion: 1,
  displayName: 'Test Move',
  description: 'A test move.',
  primitives,
  targets: { primary: 'selected_opponent', affects: 'primary_only' },
});
const volley = (over: Record<string, number | string> = {}): PrimitiveInvocation => ({
  primitive: 'projectile_volley',
  params: { count: 5, projectileShape: 'arrow', speed: 25, spreadDeg: 6, intervalMs: 100, ...over },
});

let live: SimWorld;
let liveSnapshot: Uint8Array;
const job = (b: MoveBlock, seed = 11): ValidationJob => ({ snapshot: liveSnapshot, block: b, seed, actorId: ACTOR, targetId: TARGET });

beforeAll(async () => {
  await SimWorld.init();
  live = SimWorld.create(KURUKSHETRA_STAGE, ARJUN_VS_DURYODHAN.characters, 7);
  for (let i = 0; i < 30; i++) live.step();
  liveSnapshot = live.snapshot();
});

describe('validateMoveBlock', () => {
  it('marks a normal volley valid with hits on the target, well under the step cap', () => {
    const r = validateMoveBlock(job(block(volley())), registry, realClock);
    if (!r.valid) throw new Error(`invalid: ${r.reason}`);
    expect(r.hits.map((h) => h.characterId)).toEqual(ARJUN_VS_DURYODHAN.characters.map((c) => c.id));
    const target = r.hits.find((h) => h.characterId === TARGET)!;
    expect(target.contactCount).toBeGreaterThan(0);
    expect(target.totalImpulse).toBeGreaterThan(0);
    for (const h of r.hits) {
      expect(Number.isInteger(h.contactCount) && h.contactCount >= 0).toBe(true);
      expect(Number.isFinite(h.totalImpulse) && h.totalImpulse >= 0).toBe(true);
    }
    expect(r.simSteps).toBeGreaterThan(0);
    expect(r.simSteps).toBeLessThan(MAX_SIM_STEPS);
    expect(SimWorld.fromSnapshot(r.finalSnapshot).steps).toBe(live.steps + r.simSteps);
  });

  it('gives an untouched character zero contacts and zero impulse', () => {
    // A weak impulse on the actor's own hand that cannot reach the opponent 3 m away.
    const tap = block({ primitive: 'apply_impulse', params: { segment: 'hand', magnitude: 0, angleDeg: 0 } });
    const r = validateMoveBlock(job(tap), registry, realClock);
    if (!r.valid) throw new Error(`invalid: ${r.reason}`);
    expect(r.hits.find((h) => h.characterId === TARGET)).toEqual({ characterId: TARGET, contactCount: 0, totalImpulse: 0 });
  });

  it('rejects more than 200 simultaneous spawned bodies', () => {
    const b = block(volley({ count: 100, intervalMs: 0 }), volley({ count: 100, intervalMs: 0 }), volley({ count: 1, intervalMs: 0 }));
    expect(validateMoveBlock(job(b), registry, realClock)).toMatchObject({ valid: false, reason: 'body_limit' });
  });

  it('rejects a block whose schedule runs past 8 s', () => {
    const b = block(volley({ count: 100, intervalMs: 500 }));
    expect(validateMoveBlock(job(b), registry, realClock)).toMatchObject({ valid: false, reason: 'duration' });
  });

  it('rejects a pass that exceeds the 500 ms wall-clock budget', () => {
    let t = 0;
    const slowClock = () => (t += 100); // each step "takes" 100 ms
    expect(validateMoveBlock(job(block(volley())), registry, slowClock)).toMatchObject({ valid: false, reason: 'timeout' });
  });

  it('maps unknown primitives and bad params to primitive_error', () => {
    expect(validateMoveBlock(job(block({ primitive: 'eval_code', params: {} })), registry, realClock)).toMatchObject({
      valid: false,
      reason: 'primitive_error',
    });
    expect(validateMoveBlock(job(block(volley({ speed: Number.NaN }))), registry, realClock)).toMatchObject({
      valid: false,
      reason: 'primitive_error',
    });
  });

  it('leaves the live world and the job snapshot unchanged', () => {
    const before = live.snapshot();
    const jobBytes = liveSnapshot.slice();
    validateMoveBlock(job(block(volley())), registry, realClock);
    validateMoveBlock(job(block(volley({ count: 100, intervalMs: 0 }), volley({ count: 100, intervalMs: 0 }), volley({ count: 1 }))), registry, realClock);
    expect(live.snapshot()).toEqual(before);
    expect(liveSnapshot).toEqual(jobBytes);
    expect(live.effectCount()).toBe(0);
  });

  it('is deterministic: the same job twice gives identical hits and final snapshot', () => {
    const b = block(volley(), { primitive: 'summon_object', params: { object: 'boulder', sizeScale: 1, dropHeight: 3 } });
    const a = validateMoveBlock(job(b, 99), registry, realClock);
    const c = validateMoveBlock(job(b, 99), registry, realClock);
    if (!a.valid || !c.valid) throw new Error('expected valid');
    expect(c.hits).toEqual(a.hits);
    expect(c.simSteps).toBe(a.simSteps);
    expect(c.finalSnapshot).toEqual(a.finalSnapshot);
  });
});

describe('validateWithClamp', () => {
  it('clamps an out-of-range param and validates the clamped block in a second pass', () => {
    const r = validateWithClamp(job(block(volley({ speed: 1e9 }))), registry, realClock);
    expect(r).toMatchObject({ valid: true, clamped: true, passes: 2 });
    expect(r.block.primitives[0]!.params.speed).toBe(60);
  });

  it('runs one pass when the block is valid or clamping changes nothing', () => {
    expect(validateWithClamp(job(block(volley())), registry, realClock)).toMatchObject({ valid: true, clamped: false, passes: 1 });
    expect(validateWithClamp(job(block(volley({ speed: Number.NaN }))), registry, realClock)).toMatchObject({
      valid: false,
      reason: 'primitive_error',
      clamped: false,
      passes: 1,
    });
  });

  it('replaying the validated block from the same snapshot and seed reproduces the hits', () => {
    const r = validateWithClamp(job(block(volley({ speed: 1e9 })), 5), registry, realClock);
    if (!r.valid) throw new Error('expected valid');
    const replay = validateMoveBlock(job(r.block, 5), registry, realClock);
    if (!replay.valid) throw new Error('expected valid replay');
    expect(replay.hits).toEqual(r.hits);
  });
});
