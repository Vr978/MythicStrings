// Recommendation ranking (design: "Recommendation_Engine"). Pure: no I/O, no clock.
// relevance = 0.5 · traitSimilarity + 0.2 · situational + 0.3 · novelty (Req 8.1).
import type { LibraryEntry } from '../library/types';
import type { MoveBlock } from '../moveblock/types';
import type { Trait } from '../scenario/types';
import { stem, tokenize } from '../text/similarity';

export const MAX_RECOMMENDATIONS = 5;
export const NOVELTY_UNUSED = 1;
export const NOVELTY_USED = 0.3;

export interface RecommendationContext {
  /** Traits of the acting Puppet_Character. */
  traits: readonly Trait[];
  /** Current Health_Points of the acting character and its opponent. */
  actorHP: number;
  opponentHP: number;
  /** Health_Points at Battle start; defaults to 100. */
  startingHP?: number;
  /** Library entry IDs already used in this Battle. */
  usedEntryIds?: Iterable<string>;
  /** `canonicalKey`s of Move_Blocks already used in this Battle (covers blocks stored after use). */
  usedCanonicalKeys?: Iterable<string>;
}

export interface RankedEntry {
  entry: LibraryEntry;
  relevance: number;
}

/**
 * Concept groups linking Move vocabulary to Trait vocabulary, so "Master Archer" matches a volley of
 * arrows and "Mace Mastery" or "Heavy Blows" match a mace drop or a hard impulse.
 */
const CONCEPTS: Readonly<Record<string, readonly string[]>> = {
  archery: ['arrow', 'archer', 'archery', 'bow', 'bowman', 'volley', 'projectile', 'shoot', 'quiver', 'aim', 'gandiva'],
  mace: ['mace', 'gada', 'club', 'cudgel', 'smash', 'crush', 'crushing', 'bludgeon', 'swing'],
  strength: ['strength', 'strong', 'might', 'mighty', 'power', 'powerful', 'force', 'impulse', 'boulder', 'heavy', 'blow'],
  divine: ['divine', 'celestial', 'astra', 'god', 'fireball', 'fire', 'blessed', 'heavenly'],
  focus: ['focus', 'precise', 'precision', 'accuracy', 'accurate', 'eye', 'target', 'keen'],
  illusion: ['clone', 'illusion', 'maya', 'mirror', 'shadow', 'hair', 'trick', 'deceive', 'duplicate', 'feint'],
  endurance: ['endurance', 'endure', 'resilience', 'tough', 'wall', 'shield', 'guard', 'stand', 'defence', 'defense'],
  summoning: ['summon', 'conjure', 'serpent', 'chariot', 'wheel', 'spawn'],
  speed: ['speed', 'swift', 'fast', 'quick', 'rapid', 'charge', 'lunge', 'agile'],
  spear: ['spear', 'javelin', 'lance', 'throw', 'disc', 'chakra', 'stone'],
};

/** Words too generic to count as a direct Trait/Move match. */
const GENERIC = new Set(['move', 'master', 'mastery', 'opponent', 'apply', 'object', 'count', 'body', 'never', 'every']);

const CONCEPT_OF = new Map<string, string>();
for (const [concept, words] of Object.entries(CONCEPTS)) for (const w of words) CONCEPT_OF.set(stem(w), concept);

interface Vocabulary {
  words: Set<string>;
  concepts: Set<string>;
}

function vocabulary(texts: Iterable<string>): Vocabulary {
  const words = new Set<string>();
  const concepts = new Set<string>();
  for (const t of texts) {
    for (const raw of tokenize(t)) {
      const w = stem(raw);
      const c = CONCEPT_OF.get(w);
      if (c) concepts.add(c);
      if (w.length >= 3 && !GENERIC.has(w)) words.add(w);
    }
  }
  return { words, concepts };
}

const overlaps = (a: Vocabulary, b: Vocabulary): boolean =>
  [...a.concepts].some((c) => b.concepts.has(c)) || [...a.words].some((w) => b.words.has(w));

/** Display name, description, primitive names, string parameters, and linked prompts. */
function entryTexts(entry: LibraryEntry): string[] {
  const b = entry.block;
  const texts = [b.displayName, b.description, ...entry.prompts];
  for (const inv of b.primitives) {
    texts.push(inv.primitive);
    for (const v of Object.values(inv.params)) if (typeof v === 'string') texts.push(v);
  }
  return texts;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Magnitude-weighted share of Traits that match the entry, in [0, 1]. A Trait name match counts fully;
 * a match through the Trait description only counts half.
 */
export function traitSimilarity(entry: LibraryEntry, traits: readonly Trait[]): number {
  let total = 0;
  let aligned = 0;
  const mv = vocabulary(entryTexts(entry));
  for (const t of traits) {
    const w = Math.max(0, t.magnitude);
    total += w;
    if (overlaps(vocabulary([t.name]), mv)) aligned += w;
    else if (overlaps(vocabulary([t.description]), mv)) aligned += 0.5 * w;
  }
  return total > 0 ? clamp01(aligned / total) : 0;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** How hard the block hits, in [0, 1]. */
export function attackStrength(block: MoveBlock): number {
  let best = 0;
  for (const inv of block.primitives) {
    const p = inv.params;
    let s = 0;
    switch (inv.primitive) {
      case 'apply_impulse':
        s = num(p.magnitude) / 5000;
        break;
      case 'projectile_volley':
        s = (num(p.count) * num(p.speed)) / 600;
        break;
      case 'summon_object':
        s = p.object === 'wall' ? 0 : num(p.sizeScale) / 3;
        break;
      case 'spawn_clones':
        s = p.behavior === 'charge' ? num(p.count) / 8 : 0;
        break;
    }
    best = Math.max(best, clamp01(s));
  }
  return best;
}

/** How protective the block is (a shield-like wall, or clones that surround or mirror), in [0, 1]. */
export function defensiveStrength(block: MoveBlock): number {
  let best = 0;
  for (const inv of block.primitives) {
    if (inv.primitive === 'summon_object' && inv.params.object === 'wall') best = 1;
    else if (inv.primitive === 'spawn_clones' && inv.params.behavior !== 'charge') best = Math.max(best, 0.5);
  }
  return best;
}

/** Favors hard hits when the opponent's HP is low and shields when the actor's HP is low, in [0, 1]. */
export function situational(block: MoveBlock, ctx: RecommendationContext): number {
  const start = ctx.startingHP && ctx.startingHP > 0 ? ctx.startingHP : 100;
  const opponentLow = clamp01(1 - ctx.opponentHP / start);
  const actorLow = clamp01(1 - ctx.actorHP / start);
  return clamp01(opponentLow * attackStrength(block) + actorLow * defensiveStrength(block));
}

/** Relevance of one entry in [0, 1]. */
export function relevance(entry: LibraryEntry, ctx: RecommendationContext, used: UsedSets = usedSets(ctx)): number {
  const isUsed = used.ids.has(entry.id) || used.keys.has(entry.canonicalKey);
  const novelty = isUsed ? NOVELTY_USED : NOVELTY_UNUSED;
  return 0.5 * traitSimilarity(entry, ctx.traits) + 0.2 * situational(entry.block, ctx) + 0.3 * novelty;
}

interface UsedSets {
  ids: ReadonlySet<string>;
  keys: ReadonlySet<string>;
}
const usedSets = (ctx: RecommendationContext): UsedSets => ({
  ids: new Set(ctx.usedEntryIds ?? []),
  keys: new Set(ctx.usedCanonicalKeys ?? []),
});

/**
 * Deduplicates by entry ID (keeping the higher relevance), sorts by relevance descending with entry ID
 * ascending as the tie-break, and keeps at most `limit` (default 5) entries (Req 8.1).
 */
export function rankRecommendations(
  candidates: readonly LibraryEntry[],
  ctx: RecommendationContext,
  limit: number = MAX_RECOMMENDATIONS,
): RankedEntry[] {
  const used = usedSets(ctx);
  const best = new Map<string, RankedEntry>();
  for (const entry of candidates) {
    const r = relevance(entry, ctx, used);
    const prev = best.get(entry.id);
    if (!prev || r > prev.relevance) best.set(entry.id, { entry, relevance: r });
  }
  const ranked = [...best.values()].sort(
    (a, b) => b.relevance - a.relevance || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0),
  );
  return ranked.slice(0, Math.max(0, Math.floor(limit)));
}
