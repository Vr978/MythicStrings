// Previous-Moves list (design: "Recommendation_Engine", Req 8.2). Pure.
import { canonicalKey } from '../moveblock/equivalence';
import type { MoveBlock } from '../moveblock/types';

export const MAX_PREVIOUS_MOVES = 10;

/** The part of a TurnRecord this function reads. */
export interface MoveUse {
  playerId: string;
  move: { block: MoveBlock };
}

/**
 * Up to `limit` distinct Move_Blocks used by `playerId`, newest first. `history` is in Turn order,
 * oldest first. Blocks with the same `canonicalKey` count as one Move, placed at its most recent use.
 */
export function recentDistinct(
  history: readonly MoveUse[],
  playerId: string,
  limit: number = MAX_PREVIOUS_MOVES,
): MoveBlock[] {
  const max = Math.max(0, Math.floor(limit));
  const out: MoveBlock[] = [];
  const seen = new Set<string>();
  for (let i = history.length - 1; i >= 0 && out.length < max; i--) {
    const rec = history[i]!;
    if (rec.playerId !== playerId) continue;
    const key = canonicalKey(rec.move.block);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec.move.block);
  }
  return out;
}
