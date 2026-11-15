// Move_Primitive implementation contract (design: "Move_Primitive registry").
// A primitive never touches the world directly at `apply` time beyond reading state: it schedules
// actions by simulation step through the context, so the Move_Validator and the live replay, which
// both drive the same scheduler once per step, produce identical results (Req 11.10).
import type { ParamValue, PrimitiveDescriptor } from '../../core/moveblock/types';
import type { EffectInfo, EffectSpawn, SimRng, SimWorld } from '../world';

/** Raised for unusable parameters or world state. The validator reports it as `primitive_error`. */
export class PrimitiveError extends Error {
  constructor(
    readonly primitive: string,
    message: string,
  ) {
    super(`${primitive}: ${message}`);
    this.name = 'PrimitiveError';
  }
}

/** A scheduled action. `offset` is the step offset from the start of the Move_Block execution. */
export type StepAction = (offset: number) => void;

export interface PrimitiveContext {
  readonly world: SimWorld;
  readonly actorId: string;
  /** Primary target; may equal `actorId` when the Move targets `self`. */
  readonly targetId: string;
  /** Seeded PRNG for this execution; the only source of randomness for primitives. */
  readonly rng: SimRng;
  /** Index of the invocation within the Move_Block. */
  readonly primitiveIndex: number;
  /** Effect bodies spawned so far by this primitive invocation. */
  readonly spawnCount: number;
  /** Runs `action` just before the world step at `offset` (0 = the first step after execution starts). */
  at(offset: number, action: StepAction): void;
  /** Runs `action` before every step from `from` to `to` inclusive. */
  every(from: number, to: number, action: StepAction): void;
  /** Spawns an effect body owned by the actor and increments the spawn counter. */
  spawn(spec: EffectSpawn): EffectInfo;
}

export interface MovePrimitiveImpl {
  /** Same name as the schema in `createDefaultRegistry()`. */
  readonly name: string;
  readonly descriptor: PrimitiveDescriptor;
  /** Reads and checks `params`, then schedules forces and spawns through `ctx`. */
  apply(ctx: PrimitiveContext, params: Readonly<Record<string, ParamValue>>): void;
}
