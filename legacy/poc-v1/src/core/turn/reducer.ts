// Turn_Manager pure reducer (design: "Turn_Manager", "Turn phase state machine"; Req 6, 7, 17).
//
// `reduce(state, event)` returns the next state plus the effects the turn controller must run.
// Phase order per Turn: input → moderation → resolution → validation → animation → voting → damage.
// Stored-Move selections and Fallback_Moves go straight from input to validation; the skipped phases
// complete as no-ops. Service results are accepted only when their request ID matches the one the
// state is waiting for, so stale, duplicate, or out-of-order results leave the state unchanged.
import { uniformInt } from 'pure-rand/distribution/uniformInt';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { FALLBACK_MOVES } from '../../content/fallbacks';
import { orderFallbacks } from '../fallback/orderFallbacks';
import { canonicalKey } from '../moveblock/equivalence';
import type { MoveBlock } from '../moveblock/types';
import type { Scenario } from '../scenario/types';
import { MAX_DAMAGE, NEUTRAL_VOTE_SHARE, type HitResult } from '../scoring/damage';
import { closeWindowDecision, type WindowDecision } from './closeWindow';
import { resolveDecision, type Candidate, type ResolutionTrace } from './resolveDecision';
import {
  BUDGET_GENERATE_MS,
  BUDGET_REUSE_MS,
  checkBattleConfig,
  type BattleConfig,
  type BattleEvent,
  type BattleState,
  type Category,
  type CharacterId,
  type Effect,
  type FallbackReason,
  type MoveHistoryEntry,
  type Outcome,
  type PlayerId,
  type ResolvedMove,
  type StoredMoveSelection,
  type TurnRecord,
} from './state';

export interface Step {
  state: BattleState;
  effects: Effect[];
}

export interface StartOptions {
  battleId?: string;
  /** The fixed Fallback_Move set; defaults to the hand-authored set (Req 17.1). */
  fallbacks?: readonly MoveBlock[];
}

// ---------- Pure helpers ----------

/** Clamps a Health_Points value after damage to an integer in [0, startingHP] (Req 6.10, 15.8). */
export function applyDamage(hp: number, damage: number, startingHP = 100): number {
  const d = Number.isFinite(damage) ? Math.max(0, Math.floor(damage)) : 0;
  const h = Number.isFinite(hp) ? Math.floor(hp) : 0;
  return Math.min(startingHP, Math.max(0, h - d));
}

/**
 * Next character after the current actor in the fixed cycle whose HP is above 0 (Req 6.2, 6.6).
 * Wraps around to the actor itself when it is the only one standing; `null` when nobody has HP.
 */
export function nextActor(state: Pick<BattleState, 'order' | 'actor' | 'hp'>): CharacterId | null {
  const { order, actor, hp } = state;
  const n = order.length;
  const start = order.indexOf(actor);
  for (let k = 1; k <= n; k++) {
    const id = order[(start + k) % n];
    if (id !== undefined && (hp[id] ?? 0) > 0) return id;
  }
  return null;
}

/**
 * Battle end check after damage application (Req 6.7, 6.8, 6.9): one survivor wins, no survivors is a
 * draw, and at the Turn limit the unique highest HP wins (shared highest HP is a draw).
 */
export function battleOutcome(
  state: Pick<BattleState, 'order' | 'hp' | 'turnNumber'> & { config: Pick<BattleConfig, 'turnLimit'> },
): Outcome | null {
  const alive = state.order.filter((id) => (state.hp[id] ?? 0) > 0);
  if (alive.length === 0) return { kind: 'draw', byTurnLimit: false };
  if (alive.length === 1) return { kind: 'winner', characterId: alive[0]!, byTurnLimit: false };
  const limit = state.config.turnLimit;
  if (limit !== undefined && state.turnNumber >= limit) {
    const top = Math.max(...alive.map((id) => state.hp[id] ?? 0));
    const leaders = alive.filter((id) => state.hp[id] === top);
    return leaders.length === 1
      ? { kind: 'winner', characterId: leaders[0]!, byTurnLimit: true }
      : { kind: 'draw', byTurnLimit: true };
  }
  return null;
}

/** Deterministic per-Turn seed for validation and replay (Req 11.9, 11.10). */
export function turnSeed(battleSeed: number, turnNumber: number): number {
  const rng = xoroshiro128plus((battleSeed ^ Math.imul(turnNumber, 0x9e3779b1)) | 0);
  return uniformInt(rng, 0, 0x7fffffff);
}

/** First other living character in Scenario order; first other character if all others are down. */
export function targetFor(scenario: Scenario, hp: Record<CharacterId, number>, actor: CharacterId): CharacterId {
  const others = scenario.characters.filter((c) => c.id !== actor);
  return (others.find((c) => (hp[c.id] ?? 0) > 0) ?? others[0])?.id ?? actor;
}

export function controllerOf(state: Pick<BattleState, 'scenario'>, characterId: CharacterId): PlayerId | undefined {
  return state.scenario.characters.find((c) => c.id === characterId)?.controllerPlayerId;
}

function startingHPOf(state: BattleState, id: CharacterId): number {
  return state.scenario.characters.find((c) => c.id === id)?.startingHP ?? 100;
}

/** Most recent creativity for this Player's previous use of an equivalent block (Req 15.3). */
export function previousCreativity(state: BattleState, playerId: PlayerId, block: MoveBlock): number | undefined {
  const key = canonicalKey(block);
  const list = state.moveHistory[playerId] ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.canonicalKey === key) return list[i]!.creativity;
  return undefined;
}

// ---------- Battle start ----------

/**
 * Starts a Battle: the first actor is drawn uniformly with a seeded PRNG and the Turn order is the
 * Scenario order rotated to start there (Req 6.1). The state is in the `input` phase of Turn 1 with no
 * deadline yet; the controller opens the window and sends `window_opened`.
 */
export function startBattle(scenario: Scenario, config: BattleConfig, seed: number, opts: StartOptions = {}): BattleState {
  const errors = checkBattleConfig(config);
  if (errors.length > 0) throw new RangeError(errors.join('; '));
  const n = scenario.characters.length;
  if (n < 2) throw new RangeError('a Battle needs at least 2 Puppet_Characters');

  const start = uniformInt(xoroshiro128plus(seed | 0), 0, n - 1);
  const ids = scenario.characters.map((c) => c.id);
  const order = [...ids.slice(start), ...ids.slice(0, start)];
  const hp: Record<CharacterId, number> = {};
  for (const c of scenario.characters) hp[c.id] = c.startingHP;
  const fallbacks = opts.fallbacks ?? FALLBACK_MOVES;
  const fallbackOrder = Object.fromEntries(scenario.characters.map((c) => [c.id, orderFallbacks(fallbacks, c.traits)]));
  const moveHistory = Object.fromEntries(scenario.characters.map((c) => [c.controllerPlayerId, [] as MoveHistoryEntry[]]));
  const actor = order[0]!;

  return {
    battleId: opts.battleId ?? `${scenario.id}-${seed | 0}`,
    scenario,
    config: { ...config },
    seed: seed | 0,
    fallbacks,
    fallbackOrder,
    order,
    turnNumber: 1,
    actor,
    target: targetFor(scenario, hp, actor),
    phase: 'input',
    hp,
    turn: {},
    nextRequestId: 1,
    history: [],
    moveHistory,
  };
}

// ---------- Reducer ----------

const same = (state: BattleState, effects: Effect[] = []): Step => ({ state, effects });

/** Allocates a request ID that the next service result must carry. */
function request(state: BattleState): [number, BattleState] {
  const id = state.nextRequestId;
  return [id, { ...state, nextRequestId: id + 1, turn: { ...state.turn, awaiting: id } }];
}

function actingPlayer(state: BattleState): PlayerId {
  return controllerOf(state, state.actor) ?? '';
}

export function reduce(state: BattleState, event: BattleEvent): Step {
  if (state.phase === 'ended') {
    return event.type === 'move_input'
      ? same(state, [{ type: 'notify_rejected', playerId: event.playerId, reason: 'not_your_window' }])
      : same(state);
  }

  switch (event.type) {
    case 'window_opened': {
      if (state.phase !== 'input' || state.inputDeadline !== undefined) return same(state);
      const deadline = event.now + state.config.inputWindowSec * 1000;
      return {
        state: { ...state, inputDeadline: deadline },
        effects: [{ type: 'open_input_window', playerId: actingPlayer(state), actor: state.actor, deadline }],
      };
    }

    case 'move_input': {
      const open =
        state.phase === 'input' &&
        state.inputDeadline !== undefined &&
        event.now < state.inputDeadline &&
        event.playerId === actingPlayer(state);
      if (!open) {
        // Req 6.5, 7.9: discard, leave phase and Move unchanged, tell the sender.
        return same(state, [{ type: 'notify_rejected', playerId: event.playerId, reason: 'not_your_window' }]);
      }
      const decision = closeWindowDecision(event.fieldText, event.selection ?? null, event.trigger);
      if (decision.kind === 'keep_open') {
        return same(state, decision.reason === 'empty_prompt' ? [{ type: 'notify_empty_prompt', playerId: event.playerId }] : []);
      }
      return closeWindow(state, decision, event.now);
    }

    case 'input_deadline': {
      if (state.phase !== 'input' || state.inputDeadline === undefined || event.now < state.inputDeadline) {
        return same(state);
      }
      const decision = closeWindowDecision(event.fieldText, event.selection ?? null, 'deadline');
      return decision.kind === 'keep_open' ? same(state) : closeWindow(state, decision, event.now); // deadline never keeps open
    }

    case 'moderation_result':
      return withTraceResult(state, event.requestId, 'moderate', (t) => ({ ...t, moderation: event.result }), (s) =>
        event.result.kind === 'rewritten'
          ? [{ type: 'notify_substitution', playerId: actingPlayer(s), substitution: { type: 'rewrite', category: event.result.category } }]
          : [],
      );

    case 'library_result':
      return withTraceResult(state, event.requestId, 'lookup', (t) => ({ ...t, library: event.result }));
    case 'adjust_result':
      return withTraceResult(state, event.requestId, 'adjust', (t) => ({ ...t, adjust: event.result }));
    case 'generator_result':
      return withTraceResult(state, event.requestId, 'generate', (t) => ({ ...t, generator: event.result }));
    case 'meta_moderation_result':
      return withTraceResult(state, event.requestId, 'moderate_meta', (t) => ({ ...t, meta: event.result }));

    case 'validation_result':
      return onValidation(state, event.requestId, event.now, event.result);

    case 'budget_expired': {
      const { turn } = state;
      const inFlight = state.phase === 'moderation' || state.phase === 'resolution' || state.phase === 'validation';
      if (!inFlight || turn.fallback || turn.trace === undefined || turn.budgetDeadline === undefined) return same(state);
      if (event.now < turn.budgetDeadline) return same(state);
      const trace: ResolutionTrace = { ...turn.trace, budgetExpired: true };
      return advance({ ...state, turn: { ...turn, trace } }, [], event.now);
    }

    case 'animation_finished': {
      if (state.phase !== 'animation' || event.requestId !== state.turn.awaiting) return same(state);
      if (!state.config.votingEnabled) return beginScoring(state, NEUTRAL_VOTE_SHARE, []); // Req 16.9
      const [requestId, s] = request({ ...state, phase: 'voting' });
      return { state: s, effects: [{ type: 'open_voting', requestId, durationSec: state.config.votingWindowSec }] };
    }

    case 'voting_closed': {
      if (state.phase !== 'voting' || event.requestId !== state.turn.awaiting) return same(state);
      const v = event.voteShare;
      return beginScoring(state, Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : NEUTRAL_VOTE_SHARE, []);
    }

    case 'damage_scored': {
      if (state.phase !== 'damage' || event.requestId !== state.turn.awaiting) return same(state);
      const move = state.turn.move ?? null;
      const creativity = move?.source === 'fallback' ? 0 : clamp01(event.creativity);
      return completeTurn(state, event.damage, creativity, move, []);
    }
  }
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

type ServiceStep = 'moderate' | 'lookup' | 'adjust' | 'generate' | 'moderate_meta';

/** Accepts a service result only if it answers the awaited request for the step currently pending. */
function withTraceResult(
  state: BattleState,
  requestId: number,
  step: ServiceStep,
  update: (t: ResolutionTrace) => ResolutionTrace,
  notices: (s: BattleState) => Effect[] = () => [],
): Step {
  const { turn } = state;
  if (requestId !== turn.awaiting || turn.trace === undefined || turn.fallback) return same(state);
  if (state.phase !== (step === 'moderate' ? 'moderation' : 'resolution')) return same(state);
  if (resolveDecision(turn.trace, state.config.reuseThreshold).kind !== step) return same(state);
  const next: BattleState = { ...state, turn: { ...turn, trace: update(turn.trace), awaiting: undefined } };
  return advance(next, notices(next));
}

function closeWindow(
  state: BattleState,
  decision: Exclude<WindowDecision<StoredMoveSelection>, { kind: 'keep_open' }>,
  now: number,
): Step {
  const playerId = actingPlayer(state);
  const effects: Effect[] = [{ type: 'close_input_window', playerId }];
  if (decision.kind === 'fallback') {
    const s: BattleState = { ...state, turn: { closedAt: now, trace: { input: { kind: 'none' } } } };
    return startFallback(s, decision.reason, undefined, effects);
  }
  const input = decision.kind === 'prompt' ? ({ kind: 'prompt', text: decision.text } as const) : ({ kind: 'stored', selection: decision.selection } as const);
  const budgetDeadline = now + BUDGET_REUSE_MS;
  effects.push({ type: 'set_budget', deadline: budgetDeadline });
  return advance({ ...state, turn: { closedAt: now, budgetDeadline, trace: { input } } }, effects, now);
}

/** Runs the decision table on the current trace and dispatches the resulting action. */
function advance(state: BattleState, effects: Effect[], now?: number): Step {
  const trace = state.turn.trace!;
  const action = resolveDecision(trace, state.config.reuseThreshold);
  const targetName = state.scenario.characters.find((c) => c.id === state.target)?.name ?? '';

  switch (action.kind) {
    case 'moderate': {
      const [requestId, s] = request({ ...state, phase: 'moderation' });
      return { state: s, effects: [...effects, { type: 'moderate_prompt', requestId, prompt: action.prompt, targetName }] };
    }
    case 'lookup': {
      const [requestId, s] = request({ ...state, phase: 'resolution' });
      return { state: s, effects: [...effects, { type: 'lookup_library', requestId, prompt: action.prompt }] };
    }
    case 'adjust': {
      const [requestId, s] = request({ ...state, phase: 'resolution' });
      return {
        state: s,
        effects: [...effects, { type: 'adjust_move', requestId, entryId: action.entry.id, block: action.entry.block, prompt: action.prompt }],
      };
    }
    case 'generate': {
      // The generation path gets the 4 s budget (Req 18.2).
      const budgetDeadline = (state.turn.closedAt ?? 0) + BUDGET_GENERATE_MS;
      const [requestId, s] = request({ ...state, phase: 'resolution', turn: { ...state.turn, budgetDeadline } });
      return {
        state: s,
        effects: [
          ...effects,
          { type: 'set_budget', deadline: budgetDeadline },
          { type: 'generate_move', requestId, prompt: action.prompt, budgetDeadline },
        ],
      };
    }
    case 'moderate_meta': {
      const [requestId, s] = request({ ...state, phase: 'resolution' });
      return {
        state: s,
        effects: [...effects, { type: 'moderate_meta', requestId, displayName: action.block.displayName, description: action.block.description }],
      };
    }
    case 'validate': {
      const move = candidateMove(state, action.candidate);
      return requestValidation({ ...state, turn: { ...state.turn, move } }, effects);
    }
    case 'execute':
      return beginAnimation(state, effects);
    case 'stored_invalid': {
      // Req 8.8: reopen with the original deadline while time remains.
      const deadline = state.inputDeadline;
      if (deadline !== undefined && now !== undefined && now < deadline) {
        const playerId = actingPlayer(state);
        return {
          state: { ...state, phase: 'input', turn: {} },
          effects: [
            ...effects,
            { type: 'clear_budget' },
            { type: 'notify_stored_move_invalid', playerId },
            { type: 'reopen_input_window', playerId, deadline },
          ],
        };
      }
      return startFallback(state, 'invalid_after_clamp', undefined, effects);
    }
    case 'fallback':
      return startFallback(state, action.reason, action.category, effects);
  }
}

function candidateMove(state: BattleState, c: Candidate): ResolvedMove {
  const move: ResolvedMove = { source: c.source, block: c.block, seed: turnSeed(state.seed, state.turnNumber) };
  if (c.libraryEntryId !== undefined) move.libraryEntryId = c.libraryEntryId;
  if (c.promptUsed !== undefined) move.promptUsed = c.promptUsed;
  if (c.note !== undefined) move.note = c.note;
  if (c.rewrite !== undefined) move.substitution = { type: 'rewrite', category: c.rewrite.category };
  return move;
}

function requestValidation(state: BattleState, effects: Effect[]): Step {
  const move = state.turn.move!;
  const [requestId, s] = request({ ...state, phase: 'validation' });
  return {
    state: s,
    effects: [...effects, { type: 'validate_move', requestId, block: move.block, seed: move.seed, actorId: state.actor, targetId: state.target }],
  };
}

/** Starts the Fallback_Move chain in descending similarity order (Req 17.2, 17.6). */
function startFallback(state: BattleState, reason: FallbackReason, category: Category | undefined, effects: Effect[]): Step {
  const order = (state.fallbackOrder[state.actor] ?? []).map((r) => r.index);
  const fallback = { reason, ...(category !== undefined ? { category } : {}), order, position: 0 };
  const s: BattleState = { ...state, turn: { ...state.turn, budgetDeadline: undefined, fallback, awaiting: undefined } };
  const fx: Effect[] = [...effects, { type: 'clear_budget' }];
  if (order.length === 0) return completeTurn({ ...s, phase: 'damage', turn: { ...s.turn, move: undefined } }, 0, 0, null, fx);
  return validateFallbackAt(s, 0, fx);
}

function validateFallbackAt(state: BattleState, position: number, effects: Effect[]): Step {
  const fb = state.turn.fallback!;
  const block = state.fallbacks[fb.order[position]!]!;
  const move: ResolvedMove = {
    source: 'fallback',
    block,
    substitution: { type: 'fallback', reason: fb.reason, ...(fb.category !== undefined ? { category: fb.category } : {}) },
    seed: turnSeed(state.seed, state.turnNumber),
  };
  return requestValidation({ ...state, turn: { ...state.turn, fallback: { ...fb, position }, move } }, effects);
}

function onValidation(
  state: BattleState,
  requestId: number,
  now: number,
  result: { valid: true; hits: HitResult[]; block: MoveBlock } | { valid: false },
): Step {
  const { turn } = state;
  if (state.phase !== 'validation' || requestId !== turn.awaiting || turn.move === undefined) return same(state);
  const cleared: BattleState = { ...state, turn: { ...turn, awaiting: undefined } };

  if (turn.fallback) {
    if (result.valid) {
      const move = { ...turn.move, block: result.block };
      return beginAnimation({ ...cleared, turn: { ...cleared.turn, move, hits: result.hits } }, []);
    }
    const nextPos = turn.fallback.position + 1;
    if (nextPos < turn.fallback.order.length) return validateFallbackAt(cleared, nextPos, []);
    // Req 17.7: every Fallback_Move invalid, end the Turn with damage 0 and HP unchanged.
    return completeTurn({ ...cleared, phase: 'damage', turn: { ...cleared.turn, move: undefined } }, 0, 0, null, []);
  }

  const trace: ResolutionTrace = { ...turn.trace!, validation: { valid: result.valid } };
  const next: BattleState = result.valid
    ? { ...cleared, turn: { ...cleared.turn, trace, move: { ...turn.move, block: result.block }, hits: result.hits } }
    : { ...cleared, turn: { ...cleared.turn, trace } };
  return advance(next, [], now);
}

/** Plays the validated Move; storage and usage counting happen after the animation is dispatched. */
function beginAnimation(state: BattleState, effects: Effect[]): Step {
  const move = state.turn.move!;
  const playerId = actingPlayer(state);
  const [requestId, s] = request({ ...state, phase: 'animation', turn: { ...state.turn, budgetDeadline: undefined } });
  const fx: Effect[] = [...effects, { type: 'clear_budget' }];
  if (move.source === 'fallback' && move.substitution) {
    fx.push({ type: 'notify_substitution', playerId, substitution: move.substitution, fallbackName: move.block.displayName });
  }
  if (move.note) fx.push({ type: 'notify_note', playerId, note: move.note });
  fx.push({ type: 'play_move', requestId, move, actorId: state.actor, targetId: state.target });
  // Req 10.8, 14.1, 14.5, 17.8: only accepted, valid, non-fallback Moves touch the library.
  if (move.source === 'generated' && move.promptUsed !== undefined) {
    fx.push({ type: 'store_move', block: move.block, prompt: move.promptUsed, creatorId: playerId });
  } else if (move.source !== 'fallback' && move.libraryEntryId !== undefined) {
    fx.push({ type: 'increment_usage', entryId: move.libraryEntryId });
  }
  return { state: s, effects: fx };
}

function beginScoring(state: BattleState, voteShare: number, effects: Effect[]): Step {
  const move = state.turn.move!;
  const playerId = actingPlayer(state);
  const targetHit: HitResult = state.turn.hits?.find((h) => h.characterId === state.target) ?? {
    characterId: state.target,
    contactCount: 0,
    totalImpulse: 0,
  };
  const isFallback = move.source === 'fallback';
  const prev = isFallback ? undefined : previousCreativity(state, playerId, move.block);
  const [requestId, s] = request({ ...state, phase: 'damage', turn: { ...state.turn, voteShare } });
  const score: Effect = {
    type: 'score_move',
    requestId,
    move,
    actorId: state.actor,
    targetId: state.target,
    targetHit,
    voteShare,
    isFallback,
    ...(prev !== undefined ? { previousCreativity: prev } : {}),
  };
  return { state: s, effects: [...effects, score] };
}

/** Damage application, Turn record, then the Battle end check or the next Turn (Req 6.6 to 6.9, 15.8). */
function completeTurn(state: BattleState, damage: number, creativity: number, move: ResolvedMove | null, effects: Effect[]): Step {
  const playerId = actingPlayer(state);
  const target = state.target;
  const applied = move === null ? 0 : Math.min(MAX_DAMAGE, Number.isFinite(damage) ? Math.max(0, Math.floor(damage)) : 0);
  const before = state.hp[target] ?? 0;
  const after = applyDamage(before, applied, startingHPOf(state, target));
  const hp = { ...state.hp, [target]: after };
  const fx: Effect[] = [...effects];
  if (move !== null) fx.push({ type: 'hp_changed', characterId: target, hp: after, damage: applied });

  const record: TurnRecord = {
    turnNumber: state.turnNumber,
    actor: state.actor,
    playerId,
    target,
    move,
    creativity,
    voteShare: state.turn.voteShare ?? NEUTRAL_VOTE_SHARE,
    damage: applied,
  };
  fx.push({ type: 'turn_ended', record });

  let moveHistory = state.moveHistory;
  if (move !== null && move.source !== 'fallback') {
    const entry: MoveHistoryEntry = {
      turnNumber: state.turnNumber,
      block: move.block,
      canonicalKey: canonicalKey(move.block),
      creativity,
      ...(move.libraryEntryId !== undefined ? { libraryEntryId: move.libraryEntryId } : {}),
      ...(move.promptUsed !== undefined ? { prompt: move.promptUsed } : {}),
    };
    moveHistory = { ...moveHistory, [playerId]: [...(moveHistory[playerId] ?? []), entry] };
  }

  const done: BattleState = { ...state, hp, history: [...state.history, record], moveHistory };
  const outcome = battleOutcome(done);
  if (outcome !== null) {
    return {
      state: { ...done, phase: 'ended', outcome, inputDeadline: undefined, turn: {} },
      effects: [...fx, { type: 'battle_ended', outcome }],
    };
  }

  const actor = nextActor(done)!; // non-null: battleOutcome returned null, so someone has HP
  const turnNumber = state.turnNumber + 1;
  const next: BattleState = {
    ...done,
    turnNumber,
    actor,
    target: targetFor(done.scenario, hp, actor),
    phase: 'input',
    inputDeadline: undefined,
    turn: {},
  };
  fx.push({ type: 'start_turn', turnNumber, actor, playerId: actingPlayer(next), target: next.target });
  return { state: next, effects: fx };
}

/** Effects for the first Turn after `startBattle`. */
export function initialEffects(state: BattleState): Effect[] {
  return [{ type: 'start_turn', turnNumber: state.turnNumber, actor: state.actor, playerId: actingPlayer(state), target: state.target }];
}
