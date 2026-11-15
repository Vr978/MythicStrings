import { describe, expect, it } from 'vitest';
import { FALLBACK_MOVES } from '../../content/fallbacks';
import { ARJUN, ARJUN_VS_DURYODHAN } from '../../content/scenarios/arjunVsDuryodhan';
import type { Scenario } from '../scenario/types';
import { applyDamage, battleOutcome, nextActor, reduce, startBattle, type Step } from './reducer';
import { DEFAULT_BATTLE_CONFIG, type BattleConfig, type BattleEvent, type BattleState, type Effect } from './state';

const cfg: BattleConfig = { ...DEFAULT_BATTLE_CONFIG, votingEnabled: false };
const block = FALLBACK_MOVES[0]!;
const hits = (target: number) => [
  { characterId: 'arjun', contactCount: 0, totalImpulse: 0 },
  { characterId: 'duryodhan', contactCount: target, totalImpulse: target * 3 },
];

/** A Battle where Arjun (player-1) acts first. */
function arjunFirst(config: BattleConfig = cfg): BattleState {
  for (let seed = 0; seed < 100; seed++) {
    const s = startBattle(ARJUN_VS_DURYODHAN, config, seed);
    if (s.actor === 'arjun') return s;
  }
  throw new Error('no seed found');
}

/** Applies events in order, collecting every effect. */
function run(state: BattleState, ...events: BattleEvent[]): Step {
  const effects: Effect[] = [];
  for (const e of events) {
    const step = reduce(state, e);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

const types = (fx: Effect[]) => fx.map((e) => e.type);
function last<T extends Effect['type']>(fx: Effect[], type: T): Extract<Effect, { type: T }> {
  const found = fx.filter((e) => e.type === type);
  if (found.length === 0) throw new Error(`no ${type} effect`);
  return found[found.length - 1] as Extract<Effect, { type: T }>;
}
const awaiting = (s: BattleState) => s.turn.awaiting!;

/** Opens the window and selects a stored Move for the acting Player at t=0. */
function selectStored(state: BattleState, now = 1000): Step {
  const playerId = state.scenario.characters.find((c) => c.id === state.actor)!.controllerPlayerId;
  return run(
    state,
    { type: 'window_opened', now: 0 },
    { type: 'move_input', playerId, now, trigger: 'select', fieldText: '', selection: { block, libraryEntryId: 'e1' } },
  );
}

describe('startBattle', () => {
  it('fixes a rotation of Scenario order from a seeded start', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const a = startBattle(ARJUN_VS_DURYODHAN, cfg, seed);
      expect(startBattle(ARJUN_VS_DURYODHAN, cfg, seed).order).toEqual(a.order);
      expect([['arjun', 'duryodhan'], ['duryodhan', 'arjun']]).toContainEqual(a.order);
      expect(a.actor).toBe(a.order[0]);
      expect(a.phase).toBe('input');
      expect(a.hp).toEqual({ arjun: 100, duryodhan: 100 });
      seen.add(a.actor);
    }
    expect(seen.size).toBe(2);
  });

  it('rejects out-of-range config', () => {
    expect(() => startBattle(ARJUN_VS_DURYODHAN, { ...cfg, inputWindowSec: 4 }, 1)).toThrow(RangeError);
    expect(() => startBattle(ARJUN_VS_DURYODHAN, { ...cfg, turnLimit: 201 }, 1)).toThrow(RangeError);
  });
});

describe('input acceptance (Req 6.4, 6.5, 7.9)', () => {
  const s0 = run(arjunFirst(), { type: 'window_opened', now: 0 }).state;

  it('rejects input from the non-acting Player with unchanged state', () => {
    const step = reduce(s0, { type: 'move_input', playerId: 'player-2', now: 10, trigger: 'submit', fieldText: 'mace' });
    expect(step.state).toBe(s0);
    expect(step.effects).toEqual([{ type: 'notify_rejected', playerId: 'player-2', reason: 'not_your_window' }]);
  });

  it('rejects input after the deadline or before the window opens', () => {
    const late = reduce(s0, { type: 'move_input', playerId: 'player-1', now: 10_000, trigger: 'submit', fieldText: 'x' });
    expect(late.state).toBe(s0);
    expect(types(late.effects)).toEqual(['notify_rejected']);
    const fresh = arjunFirst();
    expect(reduce(fresh, { type: 'move_input', playerId: 'player-1', now: 0, trigger: 'submit', fieldText: 'x' }).state).toBe(fresh);
  });

  it('keeps the window open on a blank submit', () => {
    const step = reduce(s0, { type: 'move_input', playerId: 'player-1', now: 10, trigger: 'submit', fieldText: '  ' });
    expect(step.state).toBe(s0);
    expect(types(step.effects)).toEqual(['notify_empty_prompt']);
  });

  it('rejects input once the window has closed', () => {
    const closed = reduce(s0, { type: 'move_input', playerId: 'player-1', now: 10, trigger: 'submit', fieldText: 'arrows' }).state;
    const again = reduce(closed, { type: 'move_input', playerId: 'player-1', now: 20, trigger: 'submit', fieldText: 'more' });
    expect(again.state).toBe(closed);
    expect(types(again.effects)).toEqual(['notify_rejected']);
  });
});

describe('free-text Turn through every phase', () => {
  it('runs input → moderation → resolution → validation → animation → damage and starts the next Turn', () => {
    const phases: string[] = [];
    let { state, effects } = run(arjunFirst(), { type: 'window_opened', now: 0 });
    const step = (e: BattleEvent) => {
      const r = reduce(state, e);
      state = r.state;
      effects = r.effects;
      phases.push(state.phase);
    };
    expect(last(effects, 'open_input_window').deadline).toBe(10_000);

    step({ type: 'move_input', playerId: 'player-1', now: 500, trigger: 'submit', fieldText: 'fire 50 arrows' });
    expect(types(effects)).toEqual(['close_input_window', 'set_budget', 'moderate_prompt']);
    expect(last(effects, 'set_budget').deadline).toBe(1500);
    expect(last(effects, 'moderate_prompt').targetName).toBe('Duryodhan');

    step({ type: 'moderation_result', requestId: awaiting(state), result: { kind: 'accepted', prompt: 'fire 50 arrows' } });
    expect(types(effects)).toEqual(['lookup_library']);
    const lookupId = awaiting(state);
    step({ type: 'library_result', requestId: lookupId, result: { kind: 'ok', entry: null, score: 0 } });
    expect(last(effects, 'set_budget').deadline).toBe(4500);
    expect(types(effects)).toContain('generate_move');

    // A duplicate of the already-handled library result is ignored.
    const before = state;
    step({ type: 'library_result', requestId: lookupId, result: { kind: 'ok', entry: null, score: 0 } });
    expect(state).toBe(before);
    phases.pop();

    step({ type: 'generator_result', requestId: awaiting(state), result: { kind: 'ok', block, note: 'used staff' } });
    expect(types(effects)).toEqual(['moderate_meta']);
    step({ type: 'meta_moderation_result', requestId: awaiting(state), result: { kind: 'acceptable' } });
    const v = last(effects, 'validate_move');
    expect(v).toMatchObject({ actorId: 'arjun', targetId: 'duryodhan' });

    step({ type: 'validation_result', requestId: awaiting(state), now: 1200, result: { valid: true, hits: hits(2), block } });
    expect(types(effects)).toEqual(['clear_budget', 'notify_note', 'play_move', 'store_move']);
    expect(last(effects, 'store_move')).toMatchObject({ prompt: 'fire 50 arrows', creatorId: 'player-1' });

    step({ type: 'animation_finished', requestId: awaiting(state) });
    const score = last(effects, 'score_move');
    expect(score).toMatchObject({ voteShare: 0.5, isFallback: false, targetHit: { characterId: 'duryodhan', contactCount: 2 } });
    expect(score.previousCreativity).toBeUndefined();

    step({ type: 'damage_scored', requestId: awaiting(state), damage: 20, creativity: 0.8 });
    expect(phases).toEqual(['moderation', 'resolution', 'resolution', 'resolution', 'validation', 'animation', 'damage', 'input']);
    expect(state.hp).toEqual({ arjun: 100, duryodhan: 80 });
    expect(state).toMatchObject({ turnNumber: 2, actor: 'duryodhan', target: 'arjun', inputDeadline: undefined });
    expect(last(effects, 'start_turn')).toMatchObject({ actor: 'duryodhan', playerId: 'player-2' });
    expect(state.moveHistory['player-1']).toHaveLength(1);
    expect(state.moveHistory['player-1']![0]).toMatchObject({ prompt: 'fire 50 arrows', creativity: 0.8 });
  });

  it('notifies the rewrite and falls back on a Guardrail rejection', () => {
    const s = run(arjunFirst(), { type: 'window_opened', now: 0 }, { type: 'move_input', playerId: 'player-1', now: 1, trigger: 'submit', fieldText: 'bad' }).state;
    const rewritten = reduce(s, { type: 'moderation_result', requestId: awaiting(s), result: { kind: 'rewritten', prompt: 'ok', category: 'slurs' } });
    expect(rewritten.effects[0]).toMatchObject({ type: 'notify_substitution', substitution: { type: 'rewrite', category: 'slurs' } });
    const rejected = reduce(s, { type: 'moderation_result', requestId: awaiting(s), result: { kind: 'fallback', reason: 'guardrail_rejected', category: 'slurs' } });
    expect(rejected.state.phase).toBe('validation');
    expect(rejected.state.turn.move).toMatchObject({ source: 'fallback', substitution: { reason: 'guardrail_rejected', category: 'slurs' } });
  });

  it('discards the Move for a Fallback_Move when the budget expires', () => {
    let s = run(arjunFirst(), { type: 'window_opened', now: 0 }, { type: 'move_input', playerId: 'player-1', now: 100, trigger: 'submit', fieldText: 'x' }).state;
    expect(reduce(s, { type: 'budget_expired', now: 1000 }).state).toBe(s); // too early
    s = reduce(s, { type: 'budget_expired', now: 1100 }).state;
    expect(s.phase).toBe('validation');
    expect(s.turn.move?.substitution).toEqual({ type: 'fallback', reason: 'budget_expired' });
  });
});

describe('stored Move selection (Req 8.4, 8.8)', () => {
  it('skips moderation and generation and counts usage', () => {
    let { state, effects } = selectStored(arjunFirst());
    expect(state.phase).toBe('validation');
    expect(types(effects)).toEqual(['open_input_window', 'close_input_window', 'set_budget', 'validate_move']);
    ({ state, effects } = run(state, { type: 'validation_result', requestId: awaiting(state), now: 1100, result: { valid: true, hits: hits(1), block } }));
    expect(types(effects)).toContain('increment_usage');
    expect(types(effects)).not.toContain('store_move');
  });

  it('reopens the window with the original deadline when the stored block is invalid', () => {
    const { state } = selectStored(arjunFirst());
    const step = reduce(state, { type: 'validation_result', requestId: awaiting(state), now: 1100, result: { valid: false } });
    expect(step.state.phase).toBe('input');
    expect(step.state.inputDeadline).toBe(10_000);
    expect(last(step.effects, 'reopen_input_window').deadline).toBe(10_000);
    expect(types(step.effects)).toContain('notify_stored_move_invalid');
  });

  it('falls back when the stored block is invalid after the deadline', () => {
    const { state } = selectStored(arjunFirst(), 9_900);
    const step = reduce(state, { type: 'validation_result', requestId: awaiting(state), now: 10_100, result: { valid: false } });
    expect(step.state.turn.move?.substitution).toEqual({ type: 'fallback', reason: 'invalid_after_clamp' });
  });
});

describe('Fallback_Moves (Req 7.6, 17.6, 17.7, 17.8)', () => {
  const timedOut = () =>
    run(arjunFirst(), { type: 'window_opened', now: 0 }, { type: 'input_deadline', now: 10_000, fieldText: ' ', selection: null });

  it('performs the first valid fallback in order and never touches the library', () => {
    let { state, effects } = timedOut();
    expect(state.turn.move).toMatchObject({ source: 'fallback', substitution: { reason: 'no_input' } });
    const order = state.fallbackOrder['arjun']!.map((r) => r.index);
    expect(state.turn.move!.block).toBe(FALLBACK_MOVES[order[0]!]);
    ({ state, effects } = run(state, { type: 'validation_result', requestId: awaiting(state), now: 10_100, result: { valid: false } }));
    expect(state.turn.move!.block).toBe(FALLBACK_MOVES[order[1]!]);
    ({ state, effects } = run(state, { type: 'validation_result', requestId: awaiting(state), now: 10_200, result: { valid: true, hits: hits(1), block: state.turn.move!.block } }));
    expect(types(effects)).toEqual(['clear_budget', 'notify_substitution', 'play_move']);
    expect(last(effects, 'notify_substitution').fallbackName).toBe(FALLBACK_MOVES[order[1]!]!.displayName);
    ({ state, effects } = run(state, { type: 'animation_finished', requestId: awaiting(state) }));
    expect(last(effects, 'score_move').isFallback).toBe(true);
    ({ state } = run(state, { type: 'damage_scored', requestId: awaiting(state), damage: 9, creativity: 0.9 }));
    expect(state.history[0]).toMatchObject({ creativity: 0, damage: 9 });
    expect(state.moveHistory['player-1']).toEqual([]);
  });

  it('ends the Turn with damage 0 when every fallback is invalid', () => {
    let { state } = timedOut();
    for (let i = 0; i < FALLBACK_MOVES.length; i++) {
      state = reduce(state, { type: 'validation_result', requestId: awaiting(state), now: 10_100, result: { valid: false } }).state;
    }
    expect(state).toMatchObject({ phase: 'input', turnNumber: 2, actor: 'duryodhan', hp: { arjun: 100, duryodhan: 100 } });
    expect(state.history[0]).toMatchObject({ move: null, damage: 0 });
  });
});

describe('voting', () => {
  it('opens voting after the animation and uses the reported Vote_Share', () => {
    let { state } = selectStored(arjunFirst({ ...cfg, votingEnabled: true, votingWindowSec: 5 }));
    state = reduce(state, { type: 'validation_result', requestId: awaiting(state), now: 1100, result: { valid: true, hits: hits(1), block } }).state;
    let step = reduce(state, { type: 'animation_finished', requestId: awaiting(state) });
    expect(step.state.phase).toBe('voting');
    expect(last(step.effects, 'open_voting').durationSec).toBe(5);
    step = reduce(step.state, { type: 'voting_closed', requestId: awaiting(step.state), voteShare: 0.75 });
    expect(last(step.effects, 'score_move').voteShare).toBe(0.75);
  });
});

describe('Battle end', () => {
  function finishTurn(state: BattleState, damage: number): Step {
    let s = selectStored(state).state;
    s = reduce(s, { type: 'validation_result', requestId: awaiting(s), now: 1100, result: { valid: true, hits: hits(1), block } }).state;
    s = reduce(s, { type: 'animation_finished', requestId: awaiting(s) }).state;
    return reduce(s, { type: 'damage_scored', requestId: awaiting(s), damage, creativity: 0.5 });
  }

  it('declares the last character standing the winner and starts no further Turns', () => {
    const s = { ...arjunFirst(), hp: { arjun: 100, duryodhan: 12 } };
    const { state, effects } = finishTurn(s, 30);
    expect(state.hp['duryodhan']).toBe(0);
    expect(state.phase).toBe('ended');
    expect(state.outcome).toEqual({ kind: 'winner', characterId: 'arjun', byTurnLimit: false });
    expect(types(effects)).not.toContain('start_turn');
    expect(last(effects, 'battle_ended').outcome.kind).toBe('winner');
    expect(reduce(state, { type: 'window_opened', now: 0 }).state).toBe(state);
  });

  it('applies the Turn limit', () => {
    const s = { ...arjunFirst({ ...cfg, turnLimit: 1 }) };
    expect(finishTurn(s, 10).state.outcome).toEqual({ kind: 'winner', characterId: 'arjun', byTurnLimit: true });
  });

  it('battleOutcome: draw, Turn-limit tie, and no outcome', () => {
    const order = ['a', 'b'];
    expect(battleOutcome({ order, hp: { a: 0, b: 0 }, turnNumber: 3, config: {} })).toEqual({ kind: 'draw', byTurnLimit: false });
    expect(battleOutcome({ order, hp: { a: 40, b: 40 }, turnNumber: 5, config: { turnLimit: 5 } })).toEqual({ kind: 'draw', byTurnLimit: true });
    expect(battleOutcome({ order, hp: { a: 40, b: 40 }, turnNumber: 4, config: { turnLimit: 5 } })).toBeNull();
    expect(battleOutcome({ order, hp: { a: 40, b: 41 }, turnNumber: 5, config: { turnLimit: 5 } })).toEqual({
      kind: 'winner',
      characterId: 'b',
      byTurnLimit: true,
    });
  });
});

describe('nextActor and applyDamage', () => {
  it('skips characters with 0 HP', () => {
    const order = ['a', 'b', 'c'];
    expect(nextActor({ order, actor: 'a', hp: { a: 5, b: 0, c: 7 } })).toBe('c');
    expect(nextActor({ order, actor: 'c', hp: { a: 0, b: 3, c: 7 } })).toBe('b');
    expect(nextActor({ order, actor: 'a', hp: { a: 5, b: 0, c: 0 } })).toBe('a');
    expect(nextActor({ order, actor: 'a', hp: { a: 0, b: 0, c: 0 } })).toBeNull();
  });

  it('skips a defeated character in a 3-character Battle', () => {
    const scenario: Scenario = {
      ...ARJUN_VS_DURYODHAN,
      characters: [...ARJUN_VS_DURYODHAN.characters, { ...ARJUN, id: 'bhima', name: 'Bhima', controllerPlayerId: 'player-3' }],
    };
    let s = startBattle(scenario, cfg, 0);
    const [first, second, third] = s.order as [string, string, string];
    s = { ...s, hp: { ...s.hp, [second]: 0 } };
    const playerId = scenario.characters.find((c) => c.id === first)!.controllerPlayerId;
    s = run(s, { type: 'window_opened', now: 0 }, { type: 'move_input', playerId, now: 1, trigger: 'select', fieldText: '', selection: { block } }).state;
    s = reduce(s, { type: 'validation_result', requestId: awaiting(s), now: 2, result: { valid: true, hits: [], block } }).state;
    s = reduce(s, { type: 'animation_finished', requestId: awaiting(s) }).state;
    s = reduce(s, { type: 'damage_scored', requestId: awaiting(s), damage: 0, creativity: 0 }).state;
    expect(s.actor).toBe(third);
  });

  it('clamps HP to [0, startingHP] as an integer', () => {
    expect(applyDamage(10, 30)).toBe(0);
    expect(applyDamage(50, 7)).toBe(43);
    expect(applyDamage(50, -5)).toBe(50);
    expect(applyDamage(50, Number.NaN)).toBe(50);
    expect(applyDamage(150, 0, 100)).toBe(100);
  });
});
