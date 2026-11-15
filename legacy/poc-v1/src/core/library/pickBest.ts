// Best-match selection for Move_Library lookups (Req 14.2, design Property 11).
import type { NearestResult, Scored } from './types';

/** The fields the tie-break needs. */
export interface Rankable {
  usageCount: number;
  createdAt: number;
}

/** Clamps to [0, 1]; NaN becomes 0. */
export const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

/**
 * Orders candidates best first: higher clamped score, then higher usage count, then earlier
 * creation time. Returns 0 for a full tie, so a stable sort keeps input order.
 */
export function compareCandidates<E extends Rankable>(a: Scored<E>, b: Scored<E>): number {
  return (
    clamp01(b.score) - clamp01(a.score) ||
    b.entry.usageCount - a.entry.usageCount ||
    a.entry.createdAt - b.entry.createdAt
  );
}

/**
 * The single best candidate with its score in [0, 1]. Full ties go to the first in input order.
 * An empty list gives `{ entry: null, score: 0 }`.
 */
export function pickBest<E extends Rankable>(candidates: readonly Scored<E>[]): NearestResult<E> {
  let best: Scored<E> | undefined;
  for (const c of candidates) {
    if (best === undefined || compareCandidates(c, best) < 0) best = c;
  }
  return best === undefined ? { entry: null, score: 0 } : { entry: best.entry, score: clamp01(best.score) };
}
