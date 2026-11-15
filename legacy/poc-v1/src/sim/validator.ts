// Headless Move_Validator (Req 11.1 to 11.5, 11.7 to 11.9).
//
// A validation pass restores the live snapshot into a fresh scratch world, executes the Move_Block
// there, and steps until the Move has settled or the 8 s (480-step) cap is reached. The live world is
// never touched: the job only carries snapshot bytes (Req 11.8).
//
// For the PoC this runs synchronously on the main thread. The wall-clock budget is checked every step
// with an injected clock; a worker with a hard kill can be added later without changing this API.
import {
  MAX_SIM_STEPS,
  MAX_SPAWNED_BODIES,
  VALIDATION_PASS_TIMEOUT_MS,
} from '../core/config';
import { clampToSchema } from '../core/moveblock/clamp';
import type { RegistryView } from '../core/moveblock/registry';
import type { MoveBlock } from '../core/moveblock/types';
import type { HitResult } from '../core/scoring/damage';
import { executeMoveBlock, PrimitiveError, type MoveExecution } from './execute';
import { SimWorld } from './world';

/** Milliseconds from an arbitrary origin (e.g. `performance.now`). */
export type Clock = () => number;

export interface ValidationJob {
  snapshot: Uint8Array;
  block: MoveBlock;
  seed: number;
  actorId: string;
  /** Primary target. Defaults to the first character in Scenario order that is not the actor. */
  targetId?: string;
}

export type InvalidReason = 'non_finite' | 'body_limit' | 'duration' | 'timeout' | 'primitive_error';

export type ValidationResult =
  | { valid: true; hits: HitResult[]; finalSnapshot: Uint8Array; simSteps: number }
  | { valid: false; reason: InvalidReason; message?: string };

/** Result of `validateWithClamp`: the last pass's result plus the block that pass validated. */
export type ValidationOutcome = ValidationResult & {
  /** The block actually validated by the final pass (clamped when `clamped` is true). Replay this. */
  block: MoveBlock;
  clamped: boolean;
  passes: 1 | 2;
};

/** Steps run after the Move settles so late contacts (a falling target, a bouncing boulder) count. */
export const SETTLE_TAIL_STEPS = 30;
/** Effect bodies slower than this (m/s and rad/s) count as at rest. */
const REST_LINEAR = 0.1;
const REST_ANGULAR = 0.2;

const invalid = (reason: InvalidReason, message?: string): ValidationResult =>
  message === undefined ? { valid: false, reason } : { valid: false, reason, message };

/** True when no action is pending and every remaining effect body has expired or come to rest. */
function settled(world: SimWorld, exec: MoveExecution): boolean {
  if (exec.pending) return false;
  for (const e of world.effects()) {
    const b = world.effectBody(e.id);
    if (b.isSleeping()) continue;
    const v = b.linvel();
    if (Math.hypot(v.x, v.y) >= REST_LINEAR || Math.abs(b.angvel()) >= REST_ANGULAR) return false;
  }
  return true;
}

/**
 * Runs one validation pass with its own 500 ms wall-clock budget. Deterministic in everything but
 * the timeout: the same snapshot, block, ids, and seed give the same hits and final snapshot.
 */
export function validateMoveBlock(job: ValidationJob, registry: RegistryView, clock: Clock): ValidationResult {
  const start = clock();
  const overBudget = (): boolean => clock() - start > VALIDATION_PASS_TIMEOUT_MS;

  const world = SimWorld.fromSnapshot(job.snapshot);
  try {
    world.resetHits(); // hit results describe this Move only
    const targetId = job.targetId ?? world.characterIds().find((id) => id !== job.actorId) ?? job.actorId;

    let exec: MoveExecution;
    try {
      exec = executeMoveBlock(world, job.block, job.actorId, targetId, job.seed, { registry });
    } catch (err) {
      if (err instanceof PrimitiveError) return invalid('primitive_error', err.message);
      throw err;
    }
    if (exec.lastActionOffset >= MAX_SIM_STEPS) return invalid('duration');

    let steps = 0;
    let tailEnd = -1;
    while (tailEnd < 0 || steps < tailEnd) {
      if (steps >= MAX_SIM_STEPS) {
        if (tailEnd >= 0) break; // settled; the tail is cut short by the cap
        return invalid('duration');
      }
      try {
        exec.beforeStep();
      } catch (err) {
        if (err instanceof PrimitiveError) return invalid('primitive_error', err.message);
        throw err;
      }
      if (world.effectCount() > MAX_SPAWNED_BODIES) return invalid('body_limit');
      world.step();
      steps += 1;
      if (!world.allFinite()) return invalid('non_finite');
      if (overBudget()) return invalid('timeout');
      if (tailEnd < 0 && settled(world, exec)) tailEnd = steps + SETTLE_TAIL_STEPS;
    }

    const hits: HitResult[] = world.hitTotals().map((h) => ({
      characterId: h.characterId,
      contactCount: h.contactCount,
      totalImpulse: Number.isFinite(h.totalImpulse) && h.totalImpulse > 0 ? h.totalImpulse : 0,
    }));
    return { valid: true, hits, finalSnapshot: world.snapshot(), simSteps: steps };
  } finally {
    world.free();
  }
}

/**
 * Validates `job.block`; when that pass is invalid and `clampToSchema` changes a parameter, validates
 * the clamped block exactly once more with a fresh budget (Req 11.5). At most two passes run.
 */
export function validateWithClamp(job: ValidationJob, registry: RegistryView, clock: Clock): ValidationOutcome {
  const first = validateMoveBlock(job, registry, clock);
  if (first.valid) return { ...first, block: job.block, clamped: false, passes: 1 };
  const { block, clamped } = clampToSchema(job.block, registry);
  if (!clamped) return { ...first, block: job.block, clamped: false, passes: 1 };
  const second = validateMoveBlock({ ...job, block }, registry, clock);
  return { ...second, block, clamped: true, passes: 2 };
}
