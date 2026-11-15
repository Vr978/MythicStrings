// Turn controller (design: "Turn phase state machine"): owns the BattleState, feeds events to the
// pure reducer, and executes the effects it returns — timers, Guardrail, Move_Library, Move_Generator,
// Move_Validator, live playback, voting, and scoring. Service results are sent back as events that
// echo the effect's request ID, so late or duplicate results are ignored by the reducer.
//
// The controller has no DOM or PixiJS dependency: the screen is a `BattleView`, time is an injected
// `Clock`, and frames arrive through `frame(dtMs)`. Tests run it headless with a ManualClock.
import { GUARDRAIL_TIMEOUT_MS, moderateMovePrompt, REWRITE_TIMEOUT_MS } from '../ai/guardrail';
import { JUDGE_TIMEOUT_MS } from '../ai/judge';
import type { LibraryEntry } from '../core/library/types';
import { canonicalKey, equivalentMoveBlocks } from '../core/moveblock/equivalence';
import type { MoveBlock } from '../core/moveblock/types';
import { MAX_PREVIOUS_MOVES, recentDistinct } from '../core/recommend/recentDistinct';
import type { Scenario } from '../core/scenario/types';
import { creativityForUse, damageScore, fallbackDamageScore, NEUTRAL_VOTE_SHARE, type ScoreBreakdown } from '../core/scoring/damage';
import { controllerOf, initialEffects, reduce, startBattle } from '../core/turn/reducer';
import type { AdjustOutcome, GeneratorOutcome, LibraryLookup, MetaModeration } from '../core/turn/resolveDecision';
import type { BattleConfig, BattleEvent, BattleState, Effect, Outcome, StoredMoveSelection } from '../core/turn/state';
import { castVote, openVoting, voteShare, type VoteState } from '../core/voting/votes';
import type { Clock, TimerHandle } from '../ui/clock';
import { fromLibraryEntry, type Recommendations } from '../ui/moveInput';
import { generatorNote, scorerFallbackNotice, substitutionNotice } from '../ui/notifications';
import { LiveStage, type ValidatedPlayback } from './liveStage';
import type { Services } from './services';
import type { BattleView } from './view';

/** Recommendation deadline when a window opens (Req 8.3, 8.6). */
export const RECOMMEND_TIMEOUT_MS = 500;
/** Typing recommendation deadline (Req 8.5). */
export const TYPING_RECOMMEND_TIMEOUT_MS = 300;
/** Move_Library lookup deadline (Req 14.2, 14.9). */
export const LIBRARY_TIMEOUT_MS = 200;
/** Move_Generator deadline (Req 9.3, 9.4). */
export const GENERATOR_TIMEOUT_MS = 3000;
/** Time kept back from the 4 s budget for name/description moderation and validation (design: "Latency budgets"). */
export const GENERATOR_RESERVE_MS = 700;
/** Pause between damage application and the next window, so the breakdown can be read. */
export const DEFAULT_TURN_GAP_MS = 1500;

type Settled<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' | 'error' };

/** Races `promise` against a deadline on the injected clock; rejections become `error`. */
function settle<T>(promise: Promise<T>, ms: number, clock: Clock): Promise<Settled<T>> {
  return new Promise((resolve) => {
    const timer = clock.setTimeout(() => resolve({ ok: false, reason: 'timeout' }), Math.max(0, ms));
    promise.then(
      (value) => {
        clock.clearTimeout(timer);
        resolve({ ok: true, value });
      },
      () => {
        clock.clearTimeout(timer);
        resolve({ ok: false, reason: 'error' });
      },
    );
  });
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export interface TurnControllerOptions {
  scenario: Scenario;
  config: BattleConfig;
  /** Battle seed: first actor, per-Turn seeds, and the live world. */
  seed: number;
  services: Services;
  view: BattleView;
  clock: Clock;
  /** Wall clock for the Move_Validator's 500 ms budget; defaults to `performance.now`. */
  simClock?: () => number;
  turnGapMs?: number;
  /** Called by the "New battle" button on the result screen. */
  onNewBattle?: () => void;
  /** Called after every reduce step, for debugging and tests. */
  onStep?: (state: BattleState, event: BattleEvent, effects: readonly Effect[]) => void;
}

export class TurnController {
  readonly live: LiveStage;
  private st: BattleState;
  private readonly o: TurnControllerOptions;
  private readonly queue: BattleEvent[] = [];
  private draining = false;
  private disposed = false;

  private inputTimer: TimerHandle | null = null;
  private budgetTimer: TimerHandle | null = null;
  private voteTimer: TimerHandle | null = null;
  private gapTimer: TimerHandle | null = null;

  private lists: { recommended: Recommendations; previous: StoredMoveSelection[] } = { recommended: [], previous: [] };
  private lastValid: ValidatedPlayback | null = null;
  private pendingLibraryOps: (() => Promise<unknown>)[] = [];
  private voterSeq = 0;

  constructor(options: TurnControllerOptions) {
    this.o = options;
    this.st = startBattle(options.scenario, options.config, options.seed);
    this.live = new LiveStage(options.scenario, options.seed, options.services.registry, options.simClock);
  }

  get state(): BattleState {
    return this.st;
  }

  /** Runs the first Turn's effects. */
  start(): void {
    this.runEffects(initialEffects(this.st));
  }

  /** Advances the live physics by one render frame. */
  frame(dtMs: number): void {
    if (!this.disposed) this.live.tick(dtMs);
  }

  dispatch(event: BattleEvent): void {
    if (this.disposed) return;
    this.queue.push(event);
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const ev = this.queue.shift()!;
        const step = reduce(this.st, ev);
        this.st = step.state;
        this.o.onStep?.(step.state, ev, step.effects);
        this.runEffects(step.effects);
      }
    } finally {
      this.draining = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of [this.inputTimer, this.budgetTimer, this.voteTimer, this.gapTimer]) if (t !== null) this.o.clock.clearTimeout(t);
    this.o.view.closeVoting();
    this.live.dispose();
  }

  // ---------- helpers ----------

  private get now(): number {
    return this.o.clock.now();
  }

  private character(id: string) {
    return this.o.scenario.characters.find((c) => c.id === id);
  }

  private playerLabel(characterId: string): string {
    const i = this.o.scenario.characters.findIndex((c) => c.id === characterId);
    return `Player ${i + 1}`;
  }

  private actingPlayer(): string {
    return controllerOf(this.st, this.st.actor) ?? '';
  }

  private clearTimer(which: 'inputTimer' | 'budgetTimer' | 'voteTimer' | 'gapTimer'): void {
    const t = this[which];
    if (t !== null) this.o.clock.clearTimeout(t);
    this[which] = null;
  }

  private runEffects(effects: readonly Effect[]): void {
    for (const fx of effects) {
      if (this.disposed) return;
      this.run(fx);
    }
  }

  private run(fx: Effect): void {
    const { view, services, clock } = this.o;
    switch (fx.type) {
      case 'start_turn': {
        view.hideInput();
        view.setWaiting(null);
        this.lastValid = null;
        this.live.unfreeze(); // e.g. after a Turn whose Fallback_Moves were all invalid (Req 17.7)
        view.turnStarted({
          turnNumber: fx.turnNumber,
          actorId: fx.actor,
          actorName: this.character(fx.actor)?.name ?? fx.actor,
          playerLabel: this.playerLabel(fx.actor),
        });
        const turnNumber = fx.turnNumber;
        const open = () => {
          this.gapTimer = null;
          void this.prepareLists().then((lists) => {
            if (this.disposed || this.st.turnNumber !== turnNumber || this.st.phase !== 'input') return;
            this.lists = lists;
            this.dispatch({ type: 'window_opened', now: this.now });
          });
        };
        const gap = fx.turnNumber === 1 ? 0 : (this.o.turnGapMs ?? DEFAULT_TURN_GAP_MS);
        this.clearTimer('gapTimer');
        this.gapTimer = clock.setTimeout(open, gap);
        return;
      }

      case 'open_input_window': {
        const playerId = fx.playerId;
        view.openInput({
          playerLabel: this.playerLabel(fx.actor),
          characterName: this.character(fx.actor)?.name ?? fx.actor,
          durationMs: Math.max(0, fx.deadline - this.now),
          recommended: this.lists.recommended,
          previous: this.lists.previous,
          onSubmit: (text) => this.dispatch({ type: 'move_input', playerId, now: this.now, trigger: 'submit', fieldText: text }),
          onSelect: (selection) =>
            this.dispatch({ type: 'move_input', playerId, now: this.now, trigger: 'select', fieldText: view.inputText(), selection }),
          onTyping: (text) => void this.onTyping(text),
          onExpire: () => this.fireDeadline(),
        });
        this.armInputDeadline(fx.deadline);
        return;
      }

      case 'reopen_input_window':
        this.live.unfreeze();
        view.setWaiting(null);
        view.reopenInput();
        this.armInputDeadline(fx.deadline);
        return;

      case 'close_input_window':
        this.clearTimer('inputTimer');
        view.closeInput();
        view.setWaiting(this.st.actor); // waiting animation from the window close (Req 18.3)
        return;

      case 'notify_rejected':
        view.notify({ kind: 'info', title: 'Input rejected', message: 'It is not your Move_Input_Window.' });
        return;
      case 'notify_empty_prompt':
        view.inputError('The move prompt is empty.');
        return;
      case 'notify_stored_move_invalid':
        view.inputError('The selected move cannot be executed on the current Stage.');
        return;
      case 'notify_substitution':
        view.notify(substitutionNotice(fx.substitution, fx.fallbackName));
        return;
      case 'notify_note':
        view.notify(generatorNote(fx.note));
        return;

      case 'set_budget':
        this.clearTimer('budgetTimer');
        this.budgetTimer = clock.setTimeout(() => {
          this.budgetTimer = null;
          this.dispatch({ type: 'budget_expired', now: this.now });
        }, Math.max(0, fx.deadline - this.now));
        return;
      case 'clear_budget':
        this.clearTimer('budgetTimer');
        return;

      case 'moderate_prompt': {
        const { requestId } = fx;
        void moderateMovePrompt(services.guardrail, fx.prompt, { targetName: fx.targetName }, {
          classifyMs: GUARDRAIL_TIMEOUT_MS,
          rewriteMs: REWRITE_TIMEOUT_MS,
        }).then(
          (result) => this.dispatch({ type: 'moderation_result', requestId, result }),
          () => this.dispatch({ type: 'moderation_result', requestId, result: { kind: 'fallback', reason: 'guardrail_unavailable' } }),
        );
        return;
      }

      case 'lookup_library': {
        const { requestId } = fx;
        void settle(services.moveLibrary.nearest(fx.prompt), LIBRARY_TIMEOUT_MS, clock).then((r) => {
          let result: LibraryLookup = { kind: 'failed' };
          if (r.ok && r.value.ok) {
            const { entry, score } = r.value.value;
            result = { kind: 'ok', entry: entry ? { id: entry.id, block: entry.block } : null, score };
          }
          this.dispatch({ type: 'library_result', requestId, result });
        });
        return;
      }

      case 'adjust_move': {
        const { requestId, block } = fx;
        const remaining = (this.st.turn.budgetDeadline ?? this.now + LIBRARY_TIMEOUT_MS) - this.now;
        void settle(services.moveGenerator.adjust(block, fx.prompt), Math.max(0, remaining), clock).then((r) => {
          const result: AdjustOutcome =
            r.ok && r.value.ok ? { kind: 'ok', block: r.value.value, changed: !equivalentMoveBlocks(block, r.value.value) } : { kind: 'failed' };
          this.dispatch({ type: 'adjust_result', requestId, result });
        });
        return;
      }

      case 'generate_move': {
        const { requestId } = fx;
        const ms = Math.max(0, Math.min(GENERATOR_TIMEOUT_MS, fx.budgetDeadline - this.now - GENERATOR_RESERVE_MS));
        void settle(services.moveGenerator.generate(fx.prompt), ms, clock).then((r) => {
          let result: GeneratorOutcome;
          if (!r.ok) result = { kind: 'failed', failure: r.reason === 'timeout' ? 'timeout' : 'error' };
          else if (!r.value.ok) result = { kind: 'failed', failure: r.value.error.kind === 'invalid_output' ? 'invalid_output' : 'error' };
          else result = { kind: 'ok', block: r.value.value.block, ...(r.value.value.note !== undefined ? { note: r.value.value.note } : {}) };
          this.dispatch({ type: 'generator_result', requestId, result });
        });
        return;
      }

      case 'moderate_meta': {
        const { requestId } = fx;
        const g = services.guardrail;
        void Promise.all([
          settle(g.classify(fx.displayName, 'display_name'), GUARDRAIL_TIMEOUT_MS, clock),
          settle(g.classify(fx.description, 'description'), GUARDRAIL_TIMEOUT_MS, clock),
        ]).then((rs) => {
          let result: MetaModeration = { kind: 'acceptable' };
          for (const r of rs) {
            if (!r.ok || !r.value.ok) {
              result = { kind: 'unavailable' };
              break;
            }
            if (r.value.value.kind === 'derogatory' && result.kind === 'acceptable') {
              result = { kind: 'derogatory', category: r.value.value.category };
            }
          }
          this.dispatch({ type: 'meta_moderation_result', requestId, result });
        });
        return;
      }

      case 'validate_move': {
        const { requestId, seed, actorId, targetId } = fx;
        let report: { valid: true; hits: ValidatedHits; block: MoveBlock } | { valid: false };
        try {
          const { outcome, snapshot } = this.live.validate(fx.block, seed, actorId, targetId);
          if (outcome.valid) {
            this.lastValid = { snapshot, block: outcome.block, seed, actorId, targetId, simSteps: outcome.simSteps };
            report = { valid: true, hits: outcome.hits, block: outcome.block };
          } else {
            report = { valid: false };
          }
        } catch {
          report = { valid: false };
        }
        this.dispatch({ type: 'validation_result', requestId, now: this.now, result: report });
        return;
      }

      case 'play_move': {
        const { requestId } = fx;
        const playback = this.lastValid;
        if (!playback || !equivalentMoveBlocks(playback.block, fx.move.block)) {
          // Cannot happen with the reducer's ordering; finish the animation phase rather than stall.
          this.dispatch({ type: 'animation_finished', requestId });
          return;
        }
        this.live.play(
          playback,
          () => {
            view.setWaiting(null); // stops on the first Move frame (Req 18.3)
            view.hideInput();
            this.flushLibraryOps();
          },
          () => this.dispatch({ type: 'animation_finished', requestId }),
        );
        return;
      }

      // Library writes run after the animation's first frame and never block the Turn (Req 14.1, 14.5, 14.10).
      case 'store_move': {
        const { block, prompt, creatorId } = fx;
        this.pendingLibraryOps.push(() => services.moveLibrary.store(block, prompt, creatorId));
        return;
      }
      case 'increment_usage': {
        const { entryId } = fx;
        this.pendingLibraryOps.push(() => services.moveLibrary.incrementUsage(entryId));
        return;
      }

      case 'open_voting':
        this.openVotingWindow(fx.requestId, fx.durationSec);
        return;

      case 'score_move':
        void this.score(fx);
        return;

      case 'hp_changed':
        view.setHp(fx.characterId, fx.hp);
        if (fx.hp === 0) this.live.releaseMotors(fx.characterId); // Req 2.5
        return;

      case 'turn_ended':
        return;

      case 'battle_ended':
        this.live.unfreeze();
        this.clearTimer('inputTimer');
        this.clearTimer('budgetTimer');
        view.hideInput();
        view.setWaiting(null);
        view.showResult(fx.outcome, this.outcomeMessage(fx.outcome), () => this.o.onNewBattle?.());
        return;
    }
  }

  private armInputDeadline(deadline: number): void {
    this.clearTimer('inputTimer');
    this.inputTimer = this.o.clock.setTimeout(() => {
      this.inputTimer = null;
      this.fireDeadline();
    }, Math.max(0, deadline - this.now));
  }

  /** Countdown reached 0: the reducer decides from the field text (Req 7.5, 7.6). */
  private fireDeadline(): void {
    this.dispatch({ type: 'input_deadline', now: this.now, fieldText: this.o.view.inputText(), selection: null });
  }

  private flushLibraryOps(): void {
    const ops = this.pendingLibraryOps;
    this.pendingLibraryOps = [];
    for (const op of ops) void op().catch(() => undefined); // a failed write leaves the Turn running (Req 14.10)
  }

  /** Recommended and previous Moves for the acting Player (Req 8.1, 8.2, 8.6, 8.7). */
  private async prepareLists(): Promise<{ recommended: Recommendations; previous: StoredMoveSelection[] }> {
    const { services, clock } = this.o;
    const st = this.st;
    const playerId = this.actingPlayer();
    const history = st.moveHistory[playerId] ?? [];

    const all = await settle(services.moveLibrary.all(), LIBRARY_TIMEOUT_MS, clock);
    const byKey = new Map<string, LibraryEntry>();
    if (all.ok) for (const e of all.value) byKey.set(e.canonicalKey, e);

    const previous = recentDistinct(
      history.map((h) => ({ playerId, move: { block: h.block } })),
      playerId,
      MAX_PREVIOUS_MOVES,
    ).map((block): StoredMoveSelection => {
      const key = canonicalKey(block);
      const used = [...history].reverse().find((h) => h.canonicalKey === key);
      const entryId = used?.libraryEntryId ?? byKey.get(key)?.id;
      const prompt = used?.prompt;
      return { block, ...(entryId !== undefined ? { libraryEntryId: entryId } : {}), ...(prompt !== undefined ? { prompt } : {}) };
    });

    const actor = this.character(st.actor);
    const usedEntryIds: string[] = [];
    const usedKeys: string[] = [];
    for (const rec of st.history) {
      if (!rec.move || rec.move.source === 'fallback') continue;
      if (rec.move.libraryEntryId) usedEntryIds.push(rec.move.libraryEntryId);
      usedKeys.push(canonicalKey(rec.move.block));
    }
    const recs = await settle(
      services.recommender.forWindow({
        traits: actor?.traits ?? [],
        actorHP: st.hp[st.actor] ?? 0,
        opponentHP: st.hp[st.target] ?? 0,
        usedEntryIds,
        usedCanonicalKeys: usedKeys,
      }),
      RECOMMEND_TIMEOUT_MS,
      clock,
    );
    const recommended: Recommendations = recs.ok ? recs.value.map(fromLibraryEntry) : 'unavailable';
    return { recommended, previous };
  }

  /** Live typing suggestions (Req 8.5); a blank field restores the window's list. */
  private async onTyping(text: string): Promise<void> {
    const { services, view, clock } = this.o;
    if (text.trim().length === 0) {
      view.updateRecommendations(this.lists.recommended);
      return;
    }
    const turn = this.st.turnNumber;
    const r = await settle(services.recommender.forTyping(text), TYPING_RECOMMEND_TIMEOUT_MS, clock);
    if (this.disposed || this.st.turnNumber !== turn || this.st.phase !== 'input') return;
    view.updateRecommendations(r.ok ? r.value.map(fromLibraryEntry) : 'unavailable');
  }

  /** Local audience Voting_Window (Req 16.1 to 16.9). */
  private openVotingWindow(requestId: number, durationSec: number): void {
    const { view, clock } = this.o;
    const players = this.o.scenario.characters.map((c) => c.controllerPlayerId);
    let votes: VoteState = openVoting(`turn-${this.st.turnNumber}`, this.now, players, durationSec);
    const durationMs = votes.closesAt - votes.opensAt;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      this.clearTimer('voteTimer');
      this.dispatch({ type: 'voting_closed', requestId, voteShare: voteShare(votes) });
    };
    const opened = view.openVoting({
      durationMs,
      moveName: this.st.turn.move?.block.displayName ?? '',
      // Each click is one audience member's vote (hot-seat PoC: no Spectator identities).
      onVote: (value) => {
        const r = castVote(votes, { voterId: `audience-${++this.voterSeq}`, value }, this.now);
        votes = r.state;
        return r.result;
      },
      onClose: finish,
    });
    if (!opened) {
      closed = true;
      this.dispatch({ type: 'voting_closed', requestId, voteShare: NEUTRAL_VOTE_SHARE });
      return;
    }
    this.voteTimer = clock.setTimeout(() => {
      this.voteTimer = null;
      view.closeVoting();
      finish();
    }, durationMs);
  }

  /** Judge + damage formula; the hit-only formula when the judge fails or times out (Req 15.1, 15.10). */
  private async score(fx: Extract<Effect, { type: 'score_move' }>): Promise<void> {
    const { services, view, clock } = this.o;
    const actor = this.character(fx.actorId);
    const target = this.character(fx.targetId);
    const history = this.st.history.flatMap((r) => (r.move ? [r.move.block] : []));
    const judged = await settle(
      services.judge.score(fx.move.block, {
        traits: actor?.traits ?? [],
        ...(fx.move.promptUsed !== undefined ? { prompt: fx.move.promptUsed } : {}),
        history,
      }),
      JUDGE_TIMEOUT_MS,
      clock,
    );
    if (this.disposed) return;

    let damage: number;
    let creativity = 0;
    let breakdown: ScoreBreakdown | undefined;
    let traitAlignment: number | undefined;
    if (judged.ok) {
      creativity = fx.isFallback ? 0 : creativityForUse(clamp01(judged.value.creativity), fx.previousCreativity);
      traitAlignment = clamp01(judged.value.traitAlignment);
      breakdown = damageScore({ targetHit: fx.targetHit, creativity, traitAlignment, voteShare: fx.voteShare });
      damage = breakdown.damage;
    } else {
      damage = fallbackDamageScore(fx.targetHit);
      view.notify(scorerFallbackNotice());
    }
    view.showDamage({
      damage,
      attackerName: actor?.name ?? fx.actorId,
      targetName: target?.name ?? fx.targetId,
      moveName: fx.move.block.displayName,
      ...(breakdown ? { breakdown, creativity, traitAlignment, voteShare: fx.voteShare } : { fallbackScorer: true }),
    });
    this.dispatch({ type: 'damage_scored', requestId: fx.requestId, damage, creativity });
  }

  private outcomeMessage(outcome: Outcome): string {
    if (outcome.kind === 'draw') return outcome.byTurnLimit ? 'The Turn limit was reached with HP tied: a draw.' : 'Both puppets have fallen: a draw.';
    const name = this.character(outcome.characterId)?.name ?? outcome.characterId;
    return outcome.byTurnLimit ? `${name} wins on Health_Points at the Turn limit.` : `${name} wins the battle!`;
  }
}

type ValidatedHits = { characterId: string; contactCount: number; totalImpulse: number }[];
