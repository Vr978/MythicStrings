// Feature: mythic-strings-shadow-puppet-battle, Property 13: Simulation determinism
//
// For any starting snapshot, valid Move_Block, and seed, validating twice from the same snapshot
// produces identical hit results (contact counts and total impulses per Puppet_Character) and
// identical final snapshot bytes.
//
// **Validates: Requirements 11.9, 11.10**
//
// Scenes are kept small (2 characters, at most 3 primitives so at most 24 effect bodies) and
// lifetimes and intervals are narrowed so 100 runs finish in reasonable time. The clock never
// advances, so the wall-clock budget cannot make one pass time out and the other not.
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../core/moveblock/primitiveSchemas';
import { arbMoveBlock } from '../core/test/arbitraries';
import { ARJUN_VS_DURYODHAN, KURUKSHETRA_STAGE } from '../content/scenarios/arjunVsDuryodhan';
import { validateMoveBlock, type ValidationJob, type ValidationResult } from './validator';
import { SimWorld } from './world';

const ACTOR = 'arjun';
const TARGET = 'duryodhan';
const registry = createDefaultRegistry();
const frozenClock = () => 0;

/** Starting snapshots taken after different amounts of settling. */
const snapshots: Uint8Array[] = [];

beforeAll(async () => {
  await SimWorld.init();
  expect(ARJUN_VS_DURYODHAN.characters).toHaveLength(2);
  for (const [worldSeed, warmSteps] of [
    [7, 0],
    [7, 30],
    [123, 75],
  ] as const) {
    const live = SimWorld.create(KURUKSHETRA_STAGE, ARJUN_VS_DURYODHAN.characters, worldSeed);
    for (let i = 0; i < warmSteps; i++) live.step();
    snapshots.push(live.snapshot());
    live.free();
  }
});

const arbBlock = arbMoveBlock(registry, {
  minPrimitives: 1,
  maxPrimitives: 3,
  maxDisplayNameLength: 8,
  maxDescriptionLength: 8,
  paramRanges: {
    projectile_volley: { count: { max: 8 }, intervalMs: { max: 100 } },
    spawn_clones: { count: { max: 4 }, lifetimeMs: { max: 1500 } },
  },
});

/** Strips the result to plain data so `toEqual` compares every field, including snapshot bytes. */
const comparable = (r: ValidationResult) =>
  r.valid
    ? { valid: true, hits: r.hits, simSteps: r.simSteps, finalSnapshot: Array.from(r.finalSnapshot) }
    : { valid: false, reason: r.reason, message: r.message };

describe('Property 13: Simulation determinism', () => {
  it(
    'validating the same snapshot, block, and seed twice gives identical hits and final snapshot bytes',
    () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 2 }),
          arbBlock,
          fc.integer({ min: 0, max: 0xffff_ffff }),
          (snapIndex, block, seed) => {
            const snapshot = snapshots[snapIndex]!;
            const before = Array.from(snapshot);
            const job: ValidationJob = { snapshot, block, seed, actorId: ACTOR, targetId: TARGET };
            const first = validateMoveBlock(job, registry, frozenClock);
            const second = validateMoveBlock(job, registry, frozenClock);
            // Hits, step counts, and every byte of the final snapshot (or the same invalid reason).
            expect(comparable(second)).toEqual(comparable(first));
            // The job's snapshot bytes are input only; validation must not mutate them.
            expect(Array.from(snapshot)).toEqual(before);
          },
        ),
        { numRuns: 100 },
      );
    },
    120_000,
  );
});
