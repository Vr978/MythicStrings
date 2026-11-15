import { describe, expect, it } from 'vitest';
import type { MoveBlock, PrimitiveInvocation } from '../core/moveblock/types';
import type { Trait } from '../core/scenario/types';
import { KeywordJudge, scoreWithTimeout, type Judge } from './judge';

const ARJUN: Trait[] = [
  { name: 'Master Archer', description: 'Looses arrows.', magnitude: 9 },
  { name: 'Divine Weapon Affinity', description: 'Celestial astras.', magnitude: 8 },
  { name: 'Focus', description: 'Sees only the eye.', magnitude: 7 },
];
const DURYODHAN: Trait[] = [
  { name: 'Mace Strength', description: 'Swings the gada.', magnitude: 9 },
  { name: 'Endurance', description: 'Keeps fighting.', magnitude: 8 },
  { name: 'Pride', description: 'Never retreats.', magnitude: 6 },
];

const block = (displayName: string, primitives: PrimitiveInvocation[]): MoveBlock => ({
  schemaVersion: 1,
  displayName,
  description: displayName,
  primitives,
  targets: { primary: 'selected_opponent', affects: 'primary_only' },
});

const volley = block('Hundred Arrows', [
  { primitive: 'projectile_volley', params: { count: 100, projectileShape: 'arrow', speed: 30, spreadDeg: 10, intervalMs: 20 } },
]);
const maceDrop = block('Falling Gada', [
  { primitive: 'summon_object', params: { object: 'mace', sizeScale: 1.5, dropHeight: 4 } },
]);
const combo = block('Boulder Then Shove', [
  { primitive: 'summon_object', params: { object: 'boulder', sizeScale: 1, dropHeight: 3 } },
  { primitive: 'apply_impulse', params: { segment: 'torso', magnitude: 500, angleDeg: 0 } },
  { primitive: 'spawn_clones', params: { count: 3, source: 'hair', lifetimeMs: 2000, behavior: 'charge' } },
]);

const judge = new KeywordJudge();

describe('KeywordJudge trait alignment', () => {
  it('aligns arrows with "Master Archer"', async () => {
    const s = await judge.score(volley, { traits: ARJUN, history: [] });
    expect(s.traitAlignment).toBeCloseTo(0.9);
  });
  it('aligns a mace with "Mace Strength"', async () => {
    const s = await judge.score(maceDrop, { traits: DURYODHAN, history: [] });
    expect(s.traitAlignment).toBeCloseTo(0.9);
  });
  it('gives 0 when nothing matches', async () => {
    const s = await judge.score(maceDrop, { traits: ARJUN, history: [] });
    expect(s.traitAlignment).toBe(0);
  });
  it('uses the Move_Prompt as well as the block', async () => {
    const s = await judge.score(maceDrop, { traits: ARJUN, prompt: 'a celestial astra strike', history: [] });
    expect(s.traitAlignment).toBeCloseTo(0.8);
  });
});

describe('KeywordJudge creativity', () => {
  it('rates multi-primitive Moves above single-primitive ones', async () => {
    const one = await judge.score(volley, { traits: ARJUN, history: [] });
    const three = await judge.score(combo, { traits: ARJUN, history: [] });
    expect(three.creativity).toBeGreaterThan(one.creativity);
    expect(three.creativity).toBeLessThanOrEqual(1);
  });
  it('drops for a Move already seen in the Battle history', async () => {
    const fresh = await judge.score(volley, { traits: ARJUN, history: [] });
    const repeat = await judge.score(volley, { traits: ARJUN, history: [volley] });
    expect(repeat.creativity).toBeLessThan(fresh.creativity);
    expect(repeat.creativity).toBeGreaterThan(0);
  });
});

describe('scoreWithTimeout (Req 15.10)', () => {
  it('returns judge scores when the judge answers in time', async () => {
    expect(await scoreWithTimeout(judge, volley, { traits: ARJUN, history: [] }, 100)).not.toBeNull();
  });
  it('returns null on timeout or judge error', async () => {
    const slow: Judge = { score: () => new Promise(() => {}) };
    const broken: Judge = { score: () => Promise.reject(new Error('down')) };
    expect(await scoreWithTimeout(slow, volley, { traits: ARJUN, history: [] }, 10)).toBeNull();
    expect(await scoreWithTimeout(broken, volley, { traits: ARJUN, history: [] }, 100)).toBeNull();
  });
});
