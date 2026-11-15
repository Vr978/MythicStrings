// Executes a Move_Block in a SimWorld (Req 2.2, 12.2, 1.6).
//
// `executeMoveBlock` looks each invocation up by name in the registry and the implementation map and
// calls its TypeScript `apply` in block order. Nothing from the block is ever evaluated as code: the
// block is data that selects among shipped implementations and supplies bounded parameters.
//
// Primitives schedule their work by step offset (projectiles every `intervalMs`, clones steering each
// step). The returned MoveExecution is driven once per simulation step by both the Move_Validator and
// the live replay, so given the same starting snapshot, block, ids, and seed they produce the same
// bodies, contacts, and hits.
import { createDefaultRegistry } from '../core/moveblock/primitiveSchemas';
import type { RegistryView } from '../core/moveblock/registry';
import type { MoveBlock } from '../core/moveblock/types';
import { PRIMITIVE_IMPLEMENTATIONS } from './primitives';
import { PrimitiveError, type MovePrimitiveImpl, type PrimitiveContext, type StepAction } from './primitives/types';
import { SimRng, type EffectInfo, type EffectSpawn, type SimWorld, type StepReport } from './world';

export { PrimitiveError } from './primitives/types';

interface ScheduledAction {
  from: number;
  to: number;
  primitiveIndex: number;
  seq: number;
  run: StepAction;
}

export interface ExecuteOptions {
  registry?: RegistryView;
  implementations?: ReadonlyMap<string, MovePrimitiveImpl>;
}

/** Step-driven schedule of one Move_Block execution. */
export class MoveExecution {
  private readonly actions: ScheduledAction[] = [];
  private seq = 0;
  private current = 0;
  private running = false;
  private spawned = 0;
  private readonly effectList: EffectInfo[] = [];

  constructor(readonly world: SimWorld) {}

  /** Step offset that the next `beforeStep` will run (number of steps driven so far). */
  get offset(): number {
    return this.current;
  }

  /** Effect bodies spawned so far by all primitives of the block. */
  get spawnCount(): number {
    return this.spawned;
  }

  /** Effects spawned so far, in spawn order. */
  get spawnedEffects(): readonly EffectInfo[] {
    return this.effectList;
  }

  /** Last step offset at which any action is scheduled, or -1 when nothing is scheduled. */
  get lastActionOffset(): number {
    return this.actions.reduce((m, a) => Math.max(m, a.to), -1);
  }

  /** True while some scheduled action has not yet run its final step. */
  get pending(): boolean {
    return this.actions.some((a) => a.to >= this.current);
  }

  /** @internal Adds an action; actions added while running start no earlier than the next step. */
  schedule(primitiveIndex: number, from: number, to: number, run: StepAction): void {
    const lo = Math.max(Math.floor(from), this.running ? this.current + 1 : this.current);
    const hi = Math.floor(to);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return;
    this.actions.push({ from: lo, to: hi, primitiveIndex, seq: this.seq++, run });
  }

  /** @internal */
  recordSpawn(info: EffectInfo): void {
    this.spawned += 1;
    this.effectList.push(info);
  }

  /**
   * Runs every action due at the current offset in canonical order (primitive index, then
   * scheduling order) and advances the offset. Call exactly once before each `world.step()`.
   */
  beforeStep(): void {
    const t = this.current;
    const due = this.actions
      .filter((a) => a.from <= t && t <= a.to)
      .sort((a, b) => a.primitiveIndex - b.primitiveIndex || a.seq - b.seq);
    this.running = true;
    try {
      for (const a of due) a.run(t);
    } finally {
      this.running = false;
    }
    this.current = t + 1;
    // Drop finished actions so long executions stay cheap.
    for (let i = this.actions.length - 1; i >= 0; i--) if (this.actions[i]!.to < this.current) this.actions.splice(i, 1);
  }

  /** `beforeStep()` followed by one fixed world step. */
  step(): StepReport {
    this.beforeStep();
    return this.world.step();
  }
}

/**
 * Applies `block` with `actorId` acting on `targetId`. All invocations are checked against the
 * registry and implementation map before any of them runs, so an unknown name changes nothing.
 * Throws PrimitiveError for unknown primitives, unknown characters, or bad parameters.
 */
export function executeMoveBlock(
  world: SimWorld,
  block: MoveBlock,
  actorId: string,
  targetId: string,
  seed: number,
  options: ExecuteOptions = {},
): MoveExecution {
  const registry = options.registry ?? defaultRegistry();
  const impls = options.implementations ?? PRIMITIVE_IMPLEMENTATIONS;
  const ids = world.characterIds();
  for (const id of [actorId, targetId]) {
    if (!ids.includes(id)) throw new PrimitiveError('execute', `unknown character ${id}`);
  }
  if (!Array.isArray(block.primitives)) throw new PrimitiveError('execute', 'block has no primitives list');
  const resolved = block.primitives.map((inv, i) => {
    const name = inv.primitive;
    const impl = typeof name === 'string' && registry.has(name) ? impls.get(name) : undefined;
    if (!impl) throw new PrimitiveError(String(name), `primitives[${i}] is not a registered Move_Primitive`);
    return { impl, params: inv.params ?? {} };
  });

  const exec = new MoveExecution(world);
  const rng = SimRng.fromSeed(seed);
  resolved.forEach(({ impl, params }, primitiveIndex) => {
    let spawnCount = 0;
    const ctx: PrimitiveContext = {
      world,
      actorId,
      targetId,
      rng,
      primitiveIndex,
      get spawnCount() {
        return spawnCount;
      },
      at: (offset, action) => exec.schedule(primitiveIndex, offset, offset, action),
      every: (from, to, action) => exec.schedule(primitiveIndex, from, to, action),
      spawn: (spec: EffectSpawn) => {
        const info = world.spawnEffect({ ...spec, ownerCharacterId: actorId });
        spawnCount += 1;
        exec.recordSpawn(info);
        return info;
      },
    };
    impl.apply(ctx, params);
  });
  return exec;
}

let cachedRegistry: RegistryView | undefined;
function defaultRegistry(): RegistryView {
  return (cachedRegistry ??= createDefaultRegistry());
}
