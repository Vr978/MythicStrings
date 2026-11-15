import { describe, expect, it } from 'vitest';
import {
  EFFECT_SECONDS, EMPTY_PROMPT_COST, INTRO_SECONDS, LINGER_SHARES, MANTRA_MAX, MATCH_SECONDS, SIM_DT, derive,
} from '../src/shared/balance';
import { normalizePrompt, resolveLocally } from '../src/shared/resolve';
import { ROSTER, findBuiltin } from '../src/shared/roster';
import { KEY, Match } from '../src/shared/sim';
import type { CharacterSheet, MoveSpec } from '../src/shared/types';

const arjuna = findBuiltin('arjuna')!;
const thor = findBuiltin('thor')!;

function fight(a: CharacterSheet = arjuna, b: CharacterSheet = thor): Match {
  const m = new Match([a, b], 1234);
  run(m, INTRO_SECONDS + 0.05);
  expect(m.state.phase).toBe('fight');
  return m;
}

function run(m: Match, seconds: number, keys: [number, number] = [0, 0]): void {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) m.step(keys);
}

/** Casts a typed prompt for player `i` and returns the move that was applied. */
function cast(m: Match, i: 0 | 1, text: string): MoveSpec {
  expect(m.openPrompt(i)).toBe(true);
  expect(m.submitPrompt(i)).toBe(true);
  const r = resolveLocally(text, 1000);
  m.resolvePrompt(i, r.move);
  return r.move;
}

describe('match rules', () => {
  it('starts each fighter at an HP equal to their rating, on the 0..100 scale', () => {
    const m = fight();
    expect(m.state.fighters[0].hp).toBe(arjuna.rating);
    expect(m.state.fighters[1].hp).toBe(thor.rating);
    for (const c of ROSTER) {
      expect(c.rating).toBeGreaterThan(0);
      expect(c.rating).toBeLessThanOrEqual(100);
    }
  });

  it('a base attack that connects takes HP and costs stamina', () => {
    const m = fight();
    run(m, 1.2, [KEY.base, 0]);
    expect(m.state.fighters[1].hp).toBeLessThan(thor.rating);
    expect(m.state.fighters[0].stamina).toBeLessThan(100);
  });

  it('a character cannot use a move its weapon does not give', () => {
    // Arjuna carries a bow: both of his moves are ranged, and there is no third move to press.
    expect(arjuna.weapon).toBe('bow');
    expect(arjuna.moves.base.delivery).toBe('projectile');
    expect(Object.keys(arjuna.moves)).toEqual(['base', 'special']);
  });

  it('ends at the two-minute cap and the fighter with more HP wins', () => {
    const m = fight();
    run(m, 0.8, [KEY.base, 0]);
    run(m, MATCH_SECONDS + 1);
    expect(m.state.phase).toBe('over');
    expect(m.state.reason).toBe('time');
    // Compared in absolute HP, as specified: Thor took a hit but still has more than Arjuna started with?
    const [a, b] = m.state.fighters;
    expect(m.state.winner).toBe(a.hp > b.hp ? 0 : 1);
  });

  it('ends at once when a fighter reaches zero HP', () => {
    const m = fight();
    m.state.fighters[1].hp = 0.5;
    run(m, 1.5, [KEY.base, 0]);
    expect(m.state.phase).toBe('over');
    expect(m.state.winner).toBe(0);
    expect(m.state.reason).toBe('ko');
    expect(m.state.fighters[1].act).toBe('ko');
  });
});

describe('effects', () => {
  it('nothing stays in the world longer than two seconds', () => {
    const m = fight();
    cast(m, 0, 'rain of fifty burning arrows from the sky');
    cast(m, 1, 'dome of light around me');
    expect(m.state.effects.length).toBe(2);
    run(m, EFFECT_SECONDS + 0.1);
    expect(m.state.effects.length).toBe(0);
  });

  it('a dome blocks an arrow volley, and stops blocking after two seconds', () => {
    const shielded = fight();
    cast(shielded, 1, 'dome shield');
    run(shielded, 1.2, [KEY.base, 0]);
    expect(shielded.state.fighters[1].hp).toBe(thor.rating);
    expect(shielded.drain().some((e) => e.type === 'block')).toBe(true);
    // The same shield, two seconds later, is gone.
    run(shielded, 1.2);
    run(shielded, 1.2, [KEY.base, 0]);
    expect(shielded.state.fighters[1].hp).toBeLessThan(thor.rating);
  });

  it('a wall does not stop what falls from above, a canopy does', () => {
    const wall = fight();
    cast(wall, 1, 'wall of stone');
    cast(wall, 0, 'rain of 40 arrows from the sky');
    run(wall, 2.2);
    expect(wall.state.fighters[1].hp).toBeLessThan(thor.rating);

    const canopy = fight();
    cast(canopy, 1, 'umbrella of cobras overhead');
    cast(canopy, 0, 'rain of 40 arrows from the sky');
    run(canopy, 2.2);
    expect(canopy.state.fighters[1].hp).toBe(thor.rating);
  });

  it('lingering damage decays tick by tick and totals exactly the instant damage', () => {
    const instant = fight();
    const a = cast(instant, 0, 'fire spear');
    run(instant, 7);
    const instantLoss = thor.rating - instant.state.fighters[1].hp;

    const linger = fight();
    const b = cast(linger, 0, 'poison spear');
    expect(b.mode).toBe('lingering');
    expect(b.damage).toBe(a.damage);
    const seen: number[] = [];
    for (let i = 0; i < Math.round(7 / SIM_DT); i++) {
      linger.step([0, 0]);
      for (const e of linger.drain()) if (e.type === 'tick') seen.push(e.dmg);
    }
    const lingerLoss = thor.rating - linger.state.fighters[1].hp;
    expect(seen.length).toBe(LINGER_SHARES.length);
    expect(seen[0]!).toBeGreaterThan(seen[1]!);
    expect(lingerLoss).toBeCloseTo(instantLoss, 5);
    expect(instantLoss).toBeGreaterThan(0);
  });

  it('a defensive prompt never deals damage, however it is worded', () => {
    const r = resolveLocally('electric spiked burning shield that electrocutes', 800);
    expect(r.move.kind).toBe('defense');
    expect(r.move.damage).toBe(0);
    // Even if a model tried to return damage on a defense, the normaliser removes it.
    const forced = normalizePrompt({ valid: true, kind: 'defense', magnitude: 5, clarity: 1, mode: 'lingering' }, 'shield', 500, 'gemini', 1);
    expect(forced.move.damage).toBe(0);
    expect(forced.move.mode).toBe('instant');
    const m = fight();
    m.openPrompt(1);
    m.submitPrompt(1);
    m.resolvePrompt(1, r.move);
    run(m, 2.5);
    expect(m.state.fighters[0].hp).toBe(arjuna.rating);
  });
});

describe('mantra prompts', () => {
  it('slows time while a prompt is open and locks the button until the bar refills', () => {
    const m = fight();
    expect(m.openPrompt(0)).toBe(true);
    m.step([0, 0]);
    expect(m.state.scale).toBeLessThan(0.2);
    expect(m.submitPrompt(0)).toBe(true);
    const move = resolveLocally('meteor', 600).move;
    m.resolvePrompt(0, move);
    m.step([0, 0]);
    expect(m.state.scale).toBe(1);
    expect(m.state.fighters[0].locked).toBe(true);
    expect(m.canPrompt(0)).toBe(false);
    expect(m.state.fighters[0].mantra).toBeCloseTo(MANTRA_MAX - move.cost, 0);
    run(m, move.cost / derive(arjuna).mantraRegen + 0.3);
    expect(m.state.fighters[0].locked).toBe(false);
    expect(m.canPrompt(0)).toBe(true);
  });

  it('charges a small cost for an empty prompt so slow motion cannot be spammed', () => {
    const m = fight();
    m.openPrompt(0);
    m.cancelPrompt(0);
    expect(m.state.fighters[0].mantra).toBe(MANTRA_MAX - EMPTY_PROMPT_COST);
    expect(m.canPrompt(0)).toBe(false);
  });

  it('both players can hold a prompt open at the same time', () => {
    const m = fight();
    expect(m.openPrompt(0)).toBe(true);
    expect(m.openPrompt(1)).toBe(true);
    expect(m.state.fighters[0].prompt).toBe(1);
    expect(m.state.fighters[1].prompt).toBe(1);
  });

  it('keeps the two-minute limit in real time during slow motion', () => {
    const m = fight();
    m.state.clock = 2;
    const before = m.state.t;
    m.openPrompt(0);
    run(m, 2.1);
    expect(m.state.phase).toBe('over');
    expect(m.state.reason).toBe('time');
    expect(m.state.t - before).toBeLessThan(0.5);
    expect(m.state.fighters[0].prompt).toBe(0);
  });

  it('never freezes: an unanswered prompt cancels itself', () => {
    const m = fight();
    m.openPrompt(0);
    run(m, 8);
    expect(m.state.fighters[0].prompt).toBe(0);
    expect(m.state.scale).toBe(1);
  });

  it('is deterministic for a given seed and input sequence', () => {
    const play = () => {
      const m = fight();
      run(m, 2, [KEY.base | KEY.right, KEY.left]);
      cast(m, 1, 'lightning storm');
      run(m, 3, [KEY.special, KEY.up]);
      return JSON.stringify(m.state);
    };
    expect(play()).toBe(play());
  });
});
