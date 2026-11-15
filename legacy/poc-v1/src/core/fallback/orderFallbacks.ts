// Fallback_Move ordering and selection (design: "Fallback set"; Req 17.2, 17.6, 17.7).
// Pure: the Turn_Manager precomputes the order per character when the Battle starts.
import type { Trait } from '../scenario/types';
import { textSimilarity } from '../text/similarity';

/** One Fallback_Move position in the fixed set with its Similarity_Score to the chosen Trait. */
export interface RankedFallback {
  /** Index into the fixed Fallback_Move set. */
  index: number;
  /** Bag-of-words cosine similarity in [0, 1]. */
  score: number;
}

/** Highest-magnitude Trait; on magnitude ties, the Trait listed first. `undefined` for an empty list. */
export function highestMagnitudeTrait<T extends Pick<Trait, 'magnitude'>>(traits: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const t of traits) if (best === undefined || t.magnitude > best.magnitude) best = t;
  return best;
}

/**
 * Orders the fixed Fallback_Move set by similarity between each description and the name of the
 * highest-magnitude Trait, descending, with set order as the tie-break (Req 17.2).
 * With no Traits every score is 0 and the set order is kept.
 */
export function orderFallbacks(
  fallbacks: readonly { description: string }[],
  traits: readonly Pick<Trait, 'name' | 'magnitude'>[],
): RankedFallback[] {
  const trait = highestMagnitudeTrait(traits);
  const ranked = fallbacks.map((f, index) => ({
    index,
    score: trait === undefined ? 0 : textSimilarity(trait.name, f.description),
  }));
  // Array.prototype.sort is stable, but the explicit index tie-break documents the rule.
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index);
}

/**
 * First Fallback_Move in `order` that `isValid` accepts (Req 17.6), or `null` when none is valid,
 * in which case the Turn ends with damage 0 and HP unchanged (Req 17.7).
 */
export function selectFallback(
  order: readonly RankedFallback[],
  isValid: (index: number) => boolean,
): number | null {
  for (const { index } of order) if (isValid(index)) return index;
  return null;
}
