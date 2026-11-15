// Turn_Manager data model (design: "Battle state", "Turn phase state machine").
// The reducer in ./reducer.ts is pure: a turn controller executes the `Effect`s it returns
// (timers, Guardrail, Move_Library, Move_Generator, Move_Validator, animation, voting, scoring)
// and feeds the results back as `BattleEvent`s.
import type { DerogatoryCategory } from '../../content/lexicon';
import {
  INPUT_WINDOW_SEC_DEFAULT,
  INPUT_WINDOW_SEC_MAX,
  INPUT_WINDOW_SEC_MIN,
  REUSE_THRESHOLD_DEFAULT,
  TURN_LIMIT_MAX,
  TURN_LIMIT_MIN,
  VOTING_WINDOW_SEC_DEFAULT,
  VOTING_WINDOW_SEC_MAX,
  VOTING_WINDOW_SEC_MIN,
} from '../config';
import type { RankedFallback } from '../fallback/orderFallbacks';
import type { MoveBlock } from '../moveblock/types';
import type { Scenario } from '../scenario/types';
import type { HitResult } from '../scoring/damage';
import type {
  AdjustOutcome,
  GeneratorOutcome,
  LibraryLookup,
  MetaModeration,
  PromptModeration,
  ResolutionTrace,
} from './resolveDecision';

export type CharacterId = string;
export type PlayerId = string;
export type Category = DerogatoryCategory;

/** Exactly one phase is active at a time (Req 6.3). `ended` means no further Turns start. */
export type Phase = 'input' | 'moderation' | 'resolution' | 'validation' | 'animation' | 'voting' | 'damage' | 'ended';

/** Why a Fallback_Move was performed (Req 17.5, 18.5). */
export type FallbackReason =
  | 'no_input'
  | 'generator_timeout_empty_library'
  | 'guardrail_rejected'
  | 'guardrail_unavailable'
  | 'invalid_after_clamp'
  | 'budget_expired';

/** Animation must start within 1 s of the window closing for library hits and stored Moves (Req 18.1, 18.4). */
export const BUDGET_REUSE_MS = 1000;
/** Animation must start within 4 s of the window closing when the Move_Generator runs (Req 18.2). */
export const BUDGET_GENERATE_MS = 4000;

export interface BattleConfig {
  /** Whole seconds, 5..30, default 10 (Req 7.1). */
  inputWindowSec: number;
  votingEnabled: boolean;
  /** Whole seconds, 1..60, default 10 (Req 16.1). */
  votingWindowSec: number;
  /** Optional, 1..200 (Req 6.9). */
  turnLimit?: number;
  /** Similarity_Score at or above which a library entry is reused (Req 14.3). */
  reuseThreshold: number;
}

export const DEFAULT_BATTLE_CONFIG: Readonly<BattleConfig> = Object.freeze({
  inputWindowSec: INPUT_WINDOW_SEC_DEFAULT,
  votingEnabled: true,
  votingWindowSec: VOTING_WINDOW_SEC_DEFAULT,
  reuseThreshold: REUSE_THRESHOLD_DEFAULT,
});

const intIn = (v: number, lo: number, hi: number): boolean => Number.isInteger(v) && v >= lo && v <= hi;

/** Range problems in `config`, empty when the config is usable. */
export function checkBattleConfig(config: BattleConfig): string[] {
  const errors: string[] = [];
  if (!intIn(config.inputWindowSec, INPUT_WINDOW_SEC_MIN, INPUT_WINDOW_SEC_MAX)) {
    errors.push(`inputWindowSec must be an integer from ${INPUT_WINDOW_SEC_MIN} to ${INPUT_WINDOW_SEC_MAX}`);
  }
  if (!intIn(config.votingWindowSec, VOTING_WINDOW_SEC_MIN, VOTING_WINDOW_SEC_MAX)) {
    errors.push(`votingWindowSec must be an integer from ${VOTING_WINDOW_SEC_MIN} to ${VOTING_WINDOW_SEC_MAX}`);
  }
  if (config.turnLimit !== undefined && !intIn(config.turnLimit, TURN_LIMIT_MIN, TURN_LIMIT_MAX)) {
    errors.push(`turnLimit must be an integer from ${TURN_LIMIT_MIN} to ${TURN_LIMIT_MAX}`);
  }
  if (!(config.reuseThreshold >= 0 && config.reuseThreshold <= 1)) {
    errors.push('reuseThreshold must be from 0 to 1');
  }
  return errors;
}

/** A recommended or previous Move the Player selected (Req 8.4). */
export interface StoredMoveSelection {
  block: MoveBlock;
  libraryEntryId?: string;
  /** Prompt the Move was created from, when known. */
  prompt?: string;
}

export type MoveSource = 'generated' | 'library' | 'library_adjusted' | 'stored_selection' | 'fallback';

export type Substitution =
  | { type: 'rewrite'; category: Category }
  | { type: 'fallback'; reason: FallbackReason; category?: Category };

export interface ResolvedMove {
  source: MoveSource;
  /** After validation this is the block that passed (clamped values included, Req 11.9). */
  block: MoveBlock;
  libraryEntryId?: string;
  /** The prompt that produced the Move; the rewritten prompt when a rewrite happened (Req 10.8). */
  promptUsed?: string;
  substitution?: Substitution;
  /** Move_Generator note on omitted or substituted effects (Req 9.5, 9.7). */
  note?: string;
  /** Seed for validation and the identical replay (Req 11.9). */
  seed: number;
}

export interface TurnRecord {
  turnNumber: number;
  actor: CharacterId;
  playerId: PlayerId;
  target: CharacterId;
  /** `null` when every Fallback_Move was invalid and the Turn ended with damage 0 (Req 17.7). */
  move: ResolvedMove | null;
  creativity: number;
  voteShare: number;
  damage: number;
}

/** One Move a Player used, for the previous-Moves list (Req 8.2) and creativity decay (Req 15.3). */
export interface MoveHistoryEntry {
  turnNumber: number;
  block: MoveBlock;
  /** `canonicalKey(block)`: identifies repeat uses even before the library assigns an ID. */
  canonicalKey: string;
  libraryEntryId?: string;
  prompt?: string;
  creativity: number;
}

export type Outcome =
  | { kind: 'winner'; characterId: CharacterId; byTurnLimit: boolean }
  | { kind: 'draw'; byTurnLimit: boolean };

/** What closed the Move_Input_Window. */
export type TurnInput =
  | { kind: 'prompt'; text: string }
  | { kind: 'stored'; selection: StoredMoveSelection }
  | { kind: 'none' };

/** Fallback chain in progress (Req 17.2, 17.6). */
export interface FallbackProgress {
  reason: FallbackReason;
  category?: Category;
  /** Indices into `BattleState.fallbacks`, best first. */
  order: number[];
  /** Position in `order` currently being validated. */
  position: number;
}

/** Work for the Turn in progress; reset when a Turn starts. */
export interface TurnWork {
  closedAt?: number;
  /** Validation must pass before this time, or a Fallback_Move runs (Req 18.5). */
  budgetDeadline?: number;
  trace?: ResolutionTrace;
  move?: ResolvedMove;
  fallback?: FallbackProgress;
  hits?: HitResult[];
  voteShare?: number;
  /** Only the service result carrying this request ID is accepted; stale and duplicate results are ignored. */
  awaiting?: number;
}

export interface BattleState {
  battleId: string;
  scenario: Scenario;
  config: BattleConfig;
  /** Battle seed; per-Turn seeds derive from it. */
  seed: number;
  /** The fixed Fallback_Move set (Req 17.1). */
  fallbacks: readonly MoveBlock[];
  /** Precomputed Fallback_Move order per character (Req 17.2, 17.3). */
  fallbackOrder: Record<CharacterId, RankedFallback[]>;
  /** Fixed cycle from the random start (Req 6.1). */
  order: CharacterId[];
  /** 1-based. */
  turnNumber: number;
  actor: CharacterId;
  /** First other living character in Scenario order (2-player PoC). */
  target: CharacterId;
  phase: Phase;
  /** Integer in [0, startingHP] (Req 6.10). */
  hp: Record<CharacterId, number>;
  /** Epoch ms; `undefined` until the controller reports `window_opened`. */
  inputDeadline?: number;
  turn: TurnWork;
  nextRequestId: number;
  history: TurnRecord[];
  /** Per Player, oldest first; Fallback_Moves are not included. */
  moveHistory: Record<PlayerId, MoveHistoryEntry[]>;
  outcome?: Outcome;
}

/** Structural subset of `ValidationOutcome` from src/sim/validator.ts. */
export type ValidationReport =
  | { valid: true; hits: HitResult[]; block: MoveBlock }
  | { valid: false };

export type BattleEvent =
  /** The controller opened the window for the acting Player at `now`. */
  | { type: 'window_opened'; now: number }
  /** Submit or click from a Player (Req 6.4, 6.5, 7.4, 7.7). */
  | {
      type: 'move_input';
      playerId: PlayerId;
      now: number;
      trigger: 'submit' | 'select';
      fieldText: string;
      selection?: StoredMoveSelection | null;
    }
  /** The countdown reached 0 (Req 7.5, 7.6, 7.8). */
  | { type: 'input_deadline'; now: number; fieldText: string; selection?: StoredMoveSelection | null }
  | { type: 'moderation_result'; requestId: number; result: PromptModeration }
  | { type: 'library_result'; requestId: number; result: LibraryLookup }
  | { type: 'adjust_result'; requestId: number; result: AdjustOutcome }
  | { type: 'generator_result'; requestId: number; result: GeneratorOutcome }
  | { type: 'meta_moderation_result'; requestId: number; result: MetaModeration }
  | { type: 'validation_result'; requestId: number; now: number; result: ValidationReport }
  /** The 1 s / 4 s budget timer fired (Req 18.5). */
  | { type: 'budget_expired'; now: number }
  | { type: 'animation_finished'; requestId: number }
  | { type: 'voting_closed'; requestId: number; voteShare: number }
  | { type: 'damage_scored'; requestId: number; damage: number; creativity: number };

export type Effect =
  /** A new Turn began; the controller opens the window and then sends `window_opened`. */
  | { type: 'start_turn'; turnNumber: number; actor: CharacterId; playerId: PlayerId; target: CharacterId }
  | { type: 'open_input_window'; playerId: PlayerId; actor: CharacterId; deadline: number }
  /** A selected stored Move was invalid; reopen with the same deadline, text, and lists (Req 8.8). */
  | { type: 'reopen_input_window'; playerId: PlayerId; deadline: number }
  /** Disable inputs and start the waiting animation (Req 7.9, 18.3). */
  | { type: 'close_input_window'; playerId: PlayerId }
  | { type: 'notify_rejected'; playerId: PlayerId; reason: 'not_your_window' }
  | { type: 'notify_empty_prompt'; playerId: PlayerId }
  | { type: 'notify_stored_move_invalid'; playerId: PlayerId }
  | { type: 'notify_substitution'; playerId: PlayerId; substitution: Substitution; fallbackName?: string }
  | { type: 'notify_note'; playerId: PlayerId; note: string }
  /** Start or move the budget timer; the controller sends `budget_expired` at `deadline`. */
  | { type: 'set_budget'; deadline: number }
  | { type: 'clear_budget' }
  | { type: 'moderate_prompt'; requestId: number; prompt: string; targetName: string }
  | { type: 'lookup_library'; requestId: number; prompt: string }
  | { type: 'adjust_move'; requestId: number; entryId: string; block: MoveBlock; prompt: string }
  /** The controller gives the generator `min(3000, budgetDeadline - now - 700)` ms. */
  | { type: 'generate_move'; requestId: number; prompt: string; budgetDeadline: number }
  | { type: 'moderate_meta'; requestId: number; displayName: string; description: string }
  | { type: 'validate_move'; requestId: number; block: MoveBlock; seed: number; actorId: CharacterId; targetId: CharacterId }
  | { type: 'play_move'; requestId: number; move: ResolvedMove; actorId: CharacterId; targetId: CharacterId }
  /** Store an accepted, valid, non-fallback block (Req 10.8, 14.1, 17.8). */
  | { type: 'store_move'; block: MoveBlock; prompt: string; creatorId: PlayerId }
  | { type: 'increment_usage'; entryId: string }
  | { type: 'open_voting'; requestId: number; durationSec: number }
  | {
      type: 'score_move';
      requestId: number;
      move: ResolvedMove;
      actorId: CharacterId;
      targetId: CharacterId;
      targetHit: HitResult;
      voteShare: number;
      /** Creativity of this Player's previous use of the same block in this Battle (Req 15.3). */
      previousCreativity?: number;
      /** Fallback_Moves score with creativity 0 (Req 17.4). */
      isFallback: boolean;
    }
  | { type: 'hp_changed'; characterId: CharacterId; hp: number; damage: number }
  | { type: 'turn_ended'; record: TurnRecord }
  | { type: 'battle_ended'; outcome: Outcome };
