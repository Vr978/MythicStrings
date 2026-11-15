// The live physics world of a Battle (design: "Move_Validator", Req 2.3, 2.5, 11.8, 11.9).
//
// Between Moves the live SimWorld steps at a fixed 1/60 s from a frame-time accumulator, so the
// standing motors keep the puppets upright. For a Move:
//   1. `freeze()` stops stepping, and `validate()` runs the Move_Validator on a scratch world restored
//      from a snapshot of the frozen live world (the live world itself is never touched, Req 11.8).
//   2. `play()` replaces the live world with a world restored from that same snapshot bytes and drives
//      `executeMoveBlock(...).step()` with the same block, ids, and seed for exactly the validated
//      number of steps, so the animation reproduces the validated hits (Req 11.9, 11.10).
import { PHYSICS_DT } from '../core/config';
import type { RegistryView } from '../core/moveblock/registry';
import type { MoveBlock } from '../core/moveblock/types';
import type { Scenario } from '../core/scenario/types';
import { executeMoveBlock, type MoveExecution } from '../sim/execute';
import { validateWithClamp, type Clock as SimClock, type ValidationOutcome } from '../sim/validator';
import { SimWorld } from '../sim/world';

const STEP_MS = PHYSICS_DT * 1000;
/** Most fixed steps per frame, so a slow frame cannot snowball into a long catch-up. */
export const MAX_STEPS_PER_FRAME = 4;

export interface ValidatedPlayback {
  /** Snapshot the validation pass started from. */
  snapshot: Uint8Array;
  /** The block that passed (clamped values included). */
  block: MoveBlock;
  seed: number;
  actorId: string;
  targetId: string;
  /** Steps the validation pass simulated; the animation ends after this many steps. */
  simSteps: number;
}

interface Playing {
  exec: MoveExecution;
  remaining: number;
  started: boolean;
  onFirstFrame: () => void;
  onDone: () => void;
}

export class LiveStage {
  private live: SimWorld;
  private acc = 0;
  private frozen = false;
  private frozenSnapshot: Uint8Array | null = null;
  private playing: Playing | null = null;

  constructor(
    scenario: Pick<Scenario, 'stage' | 'characters'>,
    seed: number,
    private readonly registry: RegistryView,
    private readonly simClock: SimClock = () => performance.now(),
  ) {
    this.live = SimWorld.create(scenario.stage, scenario.characters, seed);
  }

  /** The current live world, for the renderer. Replaced when a Move starts playing. */
  get world(): SimWorld {
    return this.live;
  }

  get isPlaying(): boolean {
    return this.playing !== null;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  /**
   * Advances the live world by the fixed steps that fit in `dtMs` (accumulator, at most
   * MAX_STEPS_PER_FRAME). While frozen nothing moves. While a Move plays each step drives the
   * Move execution; the first driven step fires `onFirstFrame`, the last fires `onDone`.
   */
  tick(dtMs: number): void {
    if (this.frozen) return;
    this.acc = Math.min(this.acc + Math.max(0, dtMs), STEP_MS * MAX_STEPS_PER_FRAME);
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      const p = this.playing;
      if (!p) {
        this.live.step();
        continue;
      }
      if (!p.started) {
        p.started = true;
        p.onFirstFrame();
      }
      p.exec.step();
      p.remaining -= 1;
      if (p.remaining <= 0) {
        this.playing = null;
        this.clearEffects();
        p.onDone();
        return; // the next Move or idle stepping resumes on the next frame
      }
    }
  }

  /** Stops stepping so validation and playback start from one fixed state. Idempotent. */
  freeze(): void {
    if (this.frozen) return;
    this.frozen = true;
    this.acc = 0;
    this.frozenSnapshot = this.live.snapshot();
  }

  /** Resumes idle stepping without playing a Move (e.g. a reopened Move_Input_Window, Req 8.8). */
  unfreeze(): void {
    this.frozen = false;
    this.frozenSnapshot = null;
  }

  /** Runs `validateWithClamp` from the frozen live state. Freezes first if needed. */
  validate(block: MoveBlock, seed: number, actorId: string, targetId: string): { outcome: ValidationOutcome; snapshot: Uint8Array } {
    this.freeze();
    const snapshot = this.frozenSnapshot!;
    const outcome = validateWithClamp({ snapshot, block, seed, actorId, targetId }, this.registry, this.simClock);
    return { outcome, snapshot };
  }

  /**
   * Restores the live world from the validated snapshot and plays the validated block with the same
   * seed for `simSteps` steps. Callbacks fire from `tick`.
   */
  play(p: ValidatedPlayback, onFirstFrame: () => void, onDone: () => void): void {
    const restored = SimWorld.fromSnapshot(p.snapshot);
    this.live.free();
    this.live = restored;
    this.live.resetHits();
    const exec = executeMoveBlock(this.live, p.block, p.actorId, p.targetId, p.seed, { registry: this.registry });
    this.playing = { exec, remaining: Math.max(1, p.simSteps), started: false, onFirstFrame, onDone };
    this.frozen = false;
    this.frozenSnapshot = null;
    this.acc = 0;
  }

  /** Releases a defeated character's motors for the rest of the Battle (Req 2.5, 2.7). */
  releaseMotors(characterId: string): void {
    this.live.releaseMotors(characterId);
  }

  /** Removes every effect body (arrows, clones, boulders) left on the Stage after a Move. */
  clearEffects(): void {
    for (const e of [...this.live.effects()]) this.live.despawnEffect(e.id);
  }

  dispose(): void {
    this.playing = null;
    this.live.free();
  }
}
