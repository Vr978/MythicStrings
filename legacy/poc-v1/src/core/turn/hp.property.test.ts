// Feature: mythic-strings-shadow-puppet-battle, Property 26: Health_Points invariant
//
// **Validates: Requirements 6.10, 15.8**
//
// For any Battle and any sequence of reducer events (damage values from 0 to 30, fallbacks, skipped
// Turns, invalid inputs), after every event every Puppet_Character's Health_Points is an integer in
// [0, startingHP], and each damage application sets the target's HP to `max(0, hp - damage)`.
//
// Events are generated from abstract random choices interpreted against the current state, so most
// sequences progress through full Turns (including Fallback_Move chains and stored-Move reopenings)
// while noise choices inject invalid inputs, stale request IDs, and out-of-phase events.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FALLBACK_MOVES } from '../../content/fallbacks';
import { ARJUN, ARJUN_VS_DURYODHAN } from '../../content/scenarios/arjunVsDuryodhan';
import type { Scenario } from '../scenario/types';
import { controllerOf, reduce, startBattle } from './reducer';
import { resolveDecision } from './resolveDecision';
import { DEFAULT_BATTLE_CONFIG, type BattleConfig, type BattleEvent, type BattleState } from './state';

const THREE_WAY: Scenario = {
  ...ARJUN_VS_DURYODHAN,
  characters: [...ARJUN_VS_DURYODHAN.characters, { ...ARJUN, id: 'bhima', name: 'Bhima', controllerPlayerId: 'player-3' }],
};

const PROMPTS = ['fire 50 arrows', 'swing the mace', '   ', '', 'shield wall'];

/** One abstract step; interpreted against the state by `toEvent`. */
interface Choice {
  /** Inject an invalid or out-of-phase event instead of the expected one. */
  noise: boolean;
  a: number;
  b: number;
  valid: boolean;
  damage: number;
  creativity: number;
  voteShare: number;
  dt: number;
}

const choiceArb: fc.Arbitrary<Choice> = fc.record({
  noise: fc.nat(4).map((n) => n === 0), // about 1 in 5 events is noise
  a: fc.nat(99),
  b: fc.nat(99),
  valid: fc.nat(3).map((n) => n !== 0),
  damage: fc.integer({ min: 0, max: 30 }),
  creativity: fc.double({ min: 0, max: 1, noNaN: true }),
  voteShare: fc.double({ min: 0, max: 1, noNaN: true }),
  // Mostly short steps so Turns progress; occasional long gaps expire windows and budgets.
  dt: fc.oneof({ weight: 9, arbitrary: fc.integer({ min: 0, max: 300 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 12_000 }) }),
});

const hitsFor = (s: BattleState, contacts: number) =>
  s.order.map((id) => ({ characterId: id, contactCount: id === s.target ? contacts : 0, totalImpulse: id === s.target ? contacts * 3 : 0 }));

function noiseEvent(s: BattleState, c: Choice, now: number): BattleEvent {
  const stale = (s.turn.awaiting ?? s.nextRequestId) + 1 + (c.b % 3);
  const players = s.scenario.characters.map((ch) => ch.controllerPlayerId);
  switch (c.a % 6) {
    case 0: {
      // Input from a Player who does not control the actor, or input outside the window.
      const playerId = players.find((p) => p !== controllerOf(s, s.actor)) ?? 'spectator';
      return { type: 'move_input', playerId, now, trigger: 'submit', fieldText: 'sneaky attack' };
    }
    case 1:
      return { type: 'damage_scored', requestId: stale, damage: c.damage, creativity: c.creativity };
    case 2:
      return { type: 'validation_result', requestId: stale, now, result: { valid: true, hits: hitsFor(s, 3), block: FALLBACK_MOVES[0]! } };
    case 3:
      return { type: 'animation_finished', requestId: stale };
    case 4:
      return { type: 'budget_expired', now };
    default:
      return { type: 'input_deadline', now, fieldText: '', selection: null };
  }
}

/** The event a well-behaved controller would send next, with random service outcomes. */
function expectedEvent(s: BattleState, c: Choice, now: number): BattleEvent {
  const requestId = s.turn.awaiting ?? -1;
  const actorPlayer = controllerOf(s, s.actor) ?? '';
  switch (s.phase) {
    case 'input': {
      if (s.inputDeadline === undefined) return { type: 'window_opened', now };
      const k = now >= s.inputDeadline ? 0 : c.a % 4;
      if (k === 0) return { type: 'input_deadline', now: Math.max(now, s.inputDeadline), fieldText: PROMPTS[c.b % PROMPTS.length]!, selection: null };
      if (k === 1) {
        const block = FALLBACK_MOVES[c.b % FALLBACK_MOVES.length]!;
        return { type: 'move_input', playerId: actorPlayer, now, trigger: 'select', fieldText: '', selection: { block, libraryEntryId: `e${c.b}` } };
      }
      return { type: 'move_input', playerId: actorPlayer, now, trigger: 'submit', fieldText: PROMPTS[c.b % PROMPTS.length]! };
    }
    case 'moderation': {
      const k = c.a % 4;
      const result =
        k === 0
          ? ({ kind: 'rewritten', prompt: 'a gentler strike', category: 'slurs' } as const)
          : k === 1
            ? ({ kind: 'fallback', reason: c.valid ? 'guardrail_rejected' : 'guardrail_unavailable' } as const)
            : ({ kind: 'accepted', prompt: 'fire 50 arrows' } as const);
      return { type: 'moderation_result', requestId, result };
    }
    case 'resolution': {
      const pending = resolveDecision(s.turn.trace!, s.config.reuseThreshold).kind;
      const block = FALLBACK_MOVES[c.b % FALLBACK_MOVES.length]!;
      if (pending === 'lookup') {
        const result =
          c.a % 3 === 0
            ? ({ kind: 'failed' } as const)
            : ({ kind: 'ok', entry: c.valid ? { id: `e${c.b}`, block } : null, score: (c.a % 100) / 100 } as const);
        return { type: 'library_result', requestId, result };
      }
      if (pending === 'adjust') {
        return { type: 'adjust_result', requestId, result: c.valid ? { kind: 'ok', block, changed: c.a % 2 === 0 } : { kind: 'failed' } };
      }
      if (pending === 'generate') {
        return { type: 'generator_result', requestId, result: c.valid ? { kind: 'ok', block } : { kind: 'failed', failure: 'timeout' } };
      }
      const k = c.a % 3;
      const result = k === 0 ? ({ kind: 'derogatory', category: 'slurs' } as const) : k === 1 ? ({ kind: 'unavailable' } as const) : ({ kind: 'acceptable' } as const);
      return { type: 'meta_moderation_result', requestId, result };
    }
    case 'validation': {
      const block = s.turn.move?.block ?? FALLBACK_MOVES[0]!;
      return {
        type: 'validation_result',
        requestId,
        now,
        result: c.valid ? { valid: true, hits: hitsFor(s, c.b % 5), block } : { valid: false },
      };
    }
    case 'animation':
      return { type: 'animation_finished', requestId };
    case 'voting':
      return { type: 'voting_closed', requestId, voteShare: c.voteShare };
    case 'damage':
      return { type: 'damage_scored', requestId, damage: c.damage, creativity: c.creativity };
    case 'ended':
      return { type: 'move_input', playerId: actorPlayer, now, trigger: 'submit', fieldText: 'one more' };
  }
}

function assertHpInvariant(s: BattleState): void {
  for (const ch of s.scenario.characters) {
    const hp = s.hp[ch.id];
    expect(Number.isInteger(hp)).toBe(true);
    expect(hp).toBeGreaterThanOrEqual(0);
    expect(hp).toBeLessThanOrEqual(ch.startingHP);
  }
}

describe('Property 26: Health_Points invariant', () => {
  it('keeps every HP an integer in [0, startingHP] and applies damage as max(0, hp - damage)', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer(),
        fc.boolean(),
        fc.option(fc.integer({ min: 1, max: 200 }), { nil: undefined }),
        // `size: 'max'` lets lengths reach 250 so many runs play enough Turns to knock a character to 0 HP.
        fc.array(choiceArb, { minLength: 1, maxLength: 250, size: 'max' }),
        (threeWay, seed, votingEnabled, turnLimit, choices) => {
          const config: BattleConfig = { ...DEFAULT_BATTLE_CONFIG, votingEnabled, ...(turnLimit !== undefined ? { turnLimit } : {}) };
          let state = startBattle(threeWay ? THREE_WAY : ARJUN_VS_DURYODHAN, config, seed);
          let now = 0;
          assertHpInvariant(state);

          for (const c of choices) {
            now += c.dt;
            const event = c.noise ? noiseEvent(state, c, now) : expectedEvent(state, c, now);
            const before = state;
            const { state: next, effects } = reduce(before, event);

            assertHpInvariant(next);

            // HP changes only through damage application on the Turn's target.
            const changed = effects.filter((e) => e.type === 'hp_changed');
            for (const ch of next.scenario.characters) {
              if (!changed.some((e) => e.characterId === ch.id)) expect(next.hp[ch.id]).toBe(before.hp[ch.id]);
            }
            for (const e of changed) {
              expect(e.characterId).toBe(before.target);
              expect(e.damage).toBe(event.type === 'damage_scored' ? event.damage : 0);
              expect(e.hp).toBe(Math.max(0, before.hp[e.characterId]! - e.damage));
              expect(next.hp[e.characterId]).toBe(e.hp);
            }
            state = next;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
