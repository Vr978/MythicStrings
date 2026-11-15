import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../library/types';
import { canonicalKey } from '../moveblock/equivalence';
import type { MoveBlock } from '../moveblock/types';
import type { Trait } from '../scenario/types';
import { rankRecommendations, relevance, situational, traitSimilarity, type RecommendationContext } from './rank';
import { recentDistinct, type MoveUse } from './recentDistinct';

const T = { primary: 'selected_opponent', affects: 'primary_only' } as const;
const arrows: MoveBlock = {
  schemaVersion: 1, displayName: 'Arrow Rain', description: 'A storm of arrows.',
  primitives: [{ primitive: 'projectile_volley', params: { count: 20, projectileShape: 'arrow', speed: 30, spreadDeg: 10, intervalMs: 20 } }],
  targets: T,
};
const mace: MoveBlock = {
  schemaVersion: 1, displayName: 'Gada Drop', description: 'A giant mace falls.',
  primitives: [{ primitive: 'summon_object', params: { object: 'mace', sizeScale: 2, dropHeight: 5 } }],
  targets: T,
};
const shove: MoveBlock = {
  schemaVersion: 1, displayName: 'Shove', description: 'A hard push.',
  primitives: [{ primitive: 'apply_impulse', params: { segment: 'torso', magnitude: 4000, angleDeg: 0 } }],
  targets: T,
};
const wall: MoveBlock = {
  schemaVersion: 1, displayName: 'Stone Wall', description: 'Raises a wall.',
  primitives: [{ primitive: 'summon_object', params: { object: 'wall', sizeScale: 1, dropHeight: 0 } }],
  targets: { primary: 'self', affects: 'primary_only' },
};
const entry = (id: string, block: MoveBlock, prompt = block.displayName): LibraryEntry => ({
  id, canonicalKey: canonicalKey(block), block, creatorId: 'p', createdAt: 0, usageCount: 0, prompts: [prompt],
});
const arjun: Trait[] = [
  { name: 'Master Archer', description: 'Unmatched with the bow.', magnitude: 9 },
  { name: 'Focus', description: 'Sees only the target.', magnitude: 6 },
];
const duryodhan: Trait[] = [
  { name: 'Mace Mastery', description: 'Wields the gada.', magnitude: 9 },
  { name: 'Brute Strength', description: 'Raw power.', magnitude: 8 },
];
const ctx = (traits: Trait[], extra: Partial<RecommendationContext> = {}): RecommendationContext => ({
  traits, actorHP: 100, opponentHP: 100, startingHP: 100, ...extra,
});
const lib = [entry('a', arrows), entry('m', mace), entry('s', shove), entry('w', wall)];

describe('traitSimilarity', () => {
  it('matches arrows to an archer and mace/impulse to a mace wielder', () => {
    expect(traitSimilarity(lib[0]!, arjun)).toBeGreaterThan(traitSimilarity(lib[1]!, arjun));
    expect(traitSimilarity(lib[1]!, duryodhan)).toBeGreaterThan(0.5);
    expect(traitSimilarity(lib[2]!, duryodhan)).toBeGreaterThan(0);
    expect(traitSimilarity(lib[0]!, duryodhan)).toBe(0);
  });
  it('is 0 without traits', () => {
    expect(traitSimilarity(lib[0]!, [])).toBe(0);
  });
});

describe('rankRecommendations', () => {
  it('ranks Arjun arrow moves first and Duryodhan mace/impulse moves first', () => {
    expect(rankRecommendations(lib, ctx(arjun))[0]!.entry.id).toBe('a');
    const d = rankRecommendations(lib, ctx(duryodhan)).map((r) => r.entry.id);
    expect(d.slice(0, 2)).toEqual(['m', 's']);
  });
  it('dedupes by ID, sorts descending, breaks ties by ID, and keeps at most 5', () => {
    const many = ['z', 'y', 'x', 'w2', 'v', 'u'].map((id) => entry(id, shove));
    const ranked = rankRecommendations([...many, many[0]!], ctx([]));
    expect(ranked.map((r) => r.entry.id)).toEqual(['u', 'v', 'w2', 'x', 'y']);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.relevance).toBeGreaterThanOrEqual(ranked[i]!.relevance);
  });
  it('lowers novelty for used entries by ID or canonical key', () => {
    const c = ctx(arjun);
    const fresh = relevance(lib[0]!, c);
    expect(relevance(lib[0]!, { ...c, usedEntryIds: ['a'] })).toBeCloseTo(fresh - 0.3 * 0.7);
    expect(relevance(lib[0]!, { ...c, usedCanonicalKeys: [lib[0]!.canonicalKey] })).toBeCloseTo(fresh - 0.21);
  });
  it('favors hard hits when the opponent is low and walls when the actor is low', () => {
    expect(situational(shove, ctx([], { opponentHP: 10 }))).toBeGreaterThan(situational(wall, ctx([], { opponentHP: 10 })));
    expect(situational(wall, ctx([], { actorHP: 10 }))).toBeGreaterThan(situational(shove, ctx([], { actorHP: 10 })));
    expect(situational(shove, ctx([]))).toBe(0);
  });
  it('returns an empty list for an empty library', () => {
    expect(rankRecommendations([], ctx(arjun))).toEqual([]);
  });
});

describe('recentDistinct', () => {
  const use = (playerId: string, block: MoveBlock): MoveUse => ({ playerId, move: { block } });
  it('returns the player\'s distinct moves newest first, at their most recent use', () => {
    const h = [use('p1', arrows), use('p2', mace), use('p1', shove), use('p1', structuredClone(arrows)), use('p2', wall)];
    expect(recentDistinct(h, 'p1', 10)).toEqual([arrows, shove]);
    expect(recentDistinct(h, 'p2')).toEqual([wall, mace]);
    expect(recentDistinct(h, 'p3')).toEqual([]);
  });
  it('caps the list at the limit', () => {
    const h = Array.from({ length: 15 }, (_, i) => use('p1', { ...shove, displayName: `Shove ${i}`, primitives: [{ primitive: 'apply_impulse', params: { segment: 'torso', magnitude: 100 + i, angleDeg: 0 } }] }));
    const r = recentDistinct(h, 'p1', 10);
    expect(r).toHaveLength(10);
    expect(r[0]!.displayName).toBe('Shove 14');
  });
});
