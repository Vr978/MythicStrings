import { describe, expect, it } from 'vitest';
import {
  CUSTOM_BASE_RATING, MANTRA_MAX, MAX_LEVEL, levelForWins, promptAttackCost, promptShieldCost, rankName, ratingForLevel, ratingFromStats,
  winsToNextLevel,
} from '../src/shared/balance';
import { applyProgress, buildCustom, heuristicLegend, normalizeLegend } from '../src/shared/designer';
import { WEAPON_INFO } from '../src/shared/moves';
import { heuristicReading, isBlocked, normalizePrompt, promptKey, resolveLocally } from '../src/shared/resolve';
import { ROSTER } from '../src/shared/roster';
import { STAT_KEYS, WEAPONS } from '../src/shared/types';

describe('progression', () => {
  it('custom characters start at 60 and reach 100 at the tenth rank', () => {
    expect(ratingForLevel(1)).toBe(CUSTOM_BASE_RATING);
    expect(ratingForLevel(MAX_LEVEL)).toBe(100);
    for (let l = 2; l <= MAX_LEVEL; l++) expect(ratingForLevel(l)).toBeGreaterThan(ratingForLevel(l - 1));
  });

  it('a rank is cleared every three wins', () => {
    expect(levelForWins(0)).toBe(1);
    expect(levelForWins(2)).toBe(1);
    expect(levelForWins(3)).toBe(2);
    expect(levelForWins(6)).toBe(3);
    expect(levelForWins(27)).toBe(10);
    expect(levelForWins(500)).toBe(10);
    expect(winsToNextLevel(4)).toBe(2);
    expect(winsToNextLevel(27)).toBe(0);
    expect(rankName(1)).toBe('Novice');
    expect(rankName(10)).toBe('Mythic');
  });

  it('legends carry no level and a fixed rating derived from the six criteria', () => {
    for (const c of ROSTER) {
      expect(c.level).toBeUndefined();
      expect(c.rating).toBe(ratingFromStats(c.stats));
      expect(Object.keys(c.stats).sort()).toEqual([...STAT_KEYS].sort());
    }
  });
});

describe('the forge', () => {
  it('caps a custom character at one base and one special, both from its weapon', () => {
    const sheet = buildCustom({ name: 'Vraj', weapon: 'bow', baseId: 'mace.smash', specialId: 'hammer.lightning' }, 'owner', 'c1', 0);
    expect(sheet.weapon).toBe('bow');
    expect(WEAPON_INFO.bow.base.map((m) => m.id)).toContain(sheet.moves.base.id);
    expect(WEAPON_INFO.bow.special.map((m) => m.id)).toContain(sheet.moves.special.id);
    expect(sheet.rating).toBe(60);
    expect(sheet.level).toBe(1);
  });

  it('bare hands get an energy blast special', () => {
    const sheet = buildCustom({ name: 'Monk', weapon: 'fists', specialId: 'fists.blast' }, 'owner', 'c2', 0);
    expect(sheet.moves.special.delivery).toBe('beam');
    expect(sheet.moves.special.element).toBe('energy');
  });

  it('wins raise rank, rating and stats together', () => {
    const base = buildCustom({ name: 'Hero', weapon: 'sword' }, 'owner', 'c3', 0);
    const later = applyProgress(base, 9);
    expect(later.level).toBe(4);
    expect(later.rating).toBeGreaterThan(base.rating);
    expect(later.stats.strength).toBe(later.rating);
    expect(later.title).toBe('Champion');
  });

  it('every weapon offers at least one base and one special move', () => {
    for (const w of WEAPONS) {
      expect(WEAPON_INFO[w].base.length).toBeGreaterThan(0);
      expect(WEAPON_INFO[w].special.length).toBeGreaterThan(0);
      for (const m of WEAPON_INFO[w].special) expect(m.damage / m.cost).toBeGreaterThan(0.2);
    }
  });
});

describe('summoned legends', () => {
  it('clamps whatever a model returns and computes the rating itself', () => {
    const draft = normalizeLegend(
      { valid: true, name: 'Odin', strength: 500, skill: -3, speed: 80, endurance: 'ninety', power: 99, wisdom: 99, weapon: 'laser', rating: 1000, headgear: 'crown-of-doom' },
      'odin', 'ai',
    );
    expect(draft.ok).toBe(true);
    expect(draft.sheet.stats.strength).toBe(99);
    expect(draft.sheet.stats.skill).toBe(40);
    expect(draft.sheet.rating).toBeLessThanOrEqual(99);
    expect(draft.sheet.weapon).toBe('sword');
    expect(draft.sheet.look.headgear).toBe('none');
    expect(draft.sheet.moves.special.damage).toBeLessThanOrEqual(13);
  });

  it('reports a refusal from the model', () => {
    const draft = normalizeLegend({ valid: false, reason: 'Not a figure of myth.' }, 'some brand', 'ai');
    expect(draft.ok).toBe(false);
    expect(draft.reason).toContain('myth');
  });

  it('builds the same legend from the same name without any model', () => {
    const a = heuristicLegend('Odin');
    const b = heuristicLegend('odin');
    expect(a.weapon).toBe('spear');
    expect(a.look).toEqual(b.look);
    expect(a.rating).toBe(b.rating);
  });
});

describe('reading a mantra', () => {
  it('tags attack or defense, never both', () => {
    expect(heuristicReading('wall of fire').kind).toBe('defense');
    expect(heuristicReading('fire arrows').kind).toBe('attack');
    expect(heuristicReading('electrostatic shield which electrocutes').kind).toBe('defense');
  });

  it('tags lingering harm', () => {
    expect(heuristicReading('poison arrows').mode).toBe('lingering');
    expect(heuristicReading('fifty arrows').mode).toBe('instant');
    expect(heuristicReading('poison shield').mode).toBe('instant');
  });

  it('reads counts and how the attack arrives', () => {
    const r = heuristicReading('50 arrows from the sky');
    expect(r.delivery).toBe('rain');
    expect(r.count).toBe(50);
    expect(heuristicReading('a thousand swords').count).toBe(50);
    expect(heuristicReading('laser beam').delivery).toBe('beam');
    expect(heuristicReading('earthquake').delivery).toBe('wave');
    expect(heuristicReading('umbrella').shield_form).toBe('canopy');
  });

  it('keeps cost within the bar and makes bigger and longer prompts cost more', () => {
    for (let m = 1; m <= 5; m++) {
      const c = promptAttackCost(m, 20, 1500);
      expect(c).toBeGreaterThanOrEqual(30);
      expect(c).toBeLessThanOrEqual(MANTRA_MAX);
    }
    expect(promptAttackCost(5, 10, 1000)).toBeGreaterThan(promptAttackCost(2, 10, 1000));
    expect(promptAttackCost(3, 70, 1000)).toBeGreaterThan(promptAttackCost(3, 8, 1000));
    expect(promptAttackCost(3, 20, 4800)).toBeGreaterThan(promptAttackCost(3, 20, 600));
    expect(promptShieldCost('dome', 10, 800)).toBeGreaterThan(promptShieldCost('wall', 10, 800));
  });

  it('weakens an unclear prompt rather than refusing it', () => {
    const clear = normalizePrompt({ valid: true, kind: 'attack', magnitude: 4, clarity: 1 }, 'meteor strike', 900, 'gemini', 1);
    const vague = normalizePrompt({ valid: true, kind: 'attack', magnitude: 4, clarity: 0.2 }, 'mtr skz', 900, 'gemini', 1);
    expect(vague.ok).toBe(true);
    expect(vague.move.damage).toBeLessThan(clear.move.damage);
  });

  it('bounds a model that asks for too much', () => {
    const r = normalizePrompt({ valid: true, kind: 'attack', delivery: 'rain', count: 9999, magnitude: 42, clarity: 7, color: 'javascript:alert(1)' }, 'x', 100, 'bedrock', 1);
    expect(r.move.count).toBe(50);
    expect(r.magnitude).toBe(5);
    expect(r.move.damage).toBeLessThanOrEqual(18);
    expect(r.move.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('treats repeats of the same words as the same prompt', () => {
    expect(promptKey('  Rain of FIRE!! ')).toBe(promptKey('rain of fire'));
    expect(resolveLocally('', 0).ok).toBe(false);
    expect(isBlocked('shield of light')).toBe(false);
  });
});
