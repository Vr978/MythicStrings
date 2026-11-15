// Move_Library entry model (design: "Move_Library tables"). Pure types shared by core and adapters.
import type { MoveBlock } from '../moveblock/types';

export interface LibraryEntry {
  id: string;
  /** `canonicalKey(block)`: one entry per key (Req 14.6). */
  canonicalKey: string;
  block: MoveBlock;
  /** Player identifier of the first store (Req 14.1). */
  creatorId: string;
  /** Milliseconds since the Unix epoch, from the first store. */
  createdAt: number;
  /** Executions so far; starts at 0 (Req 14.1, 14.5). */
  usageCount: number;
  /** Originating prompt first, then linked prompts in link order, no duplicates (Req 14.6, 14.7). */
  prompts: string[];
}

/** One scored lookup result. */
export interface Scored<E> {
  entry: E;
  /** Similarity_Score; `pickBest` clamps it to [0, 1]. */
  score: number;
}

export interface NearestResult<E = LibraryEntry> {
  entry: E | null;
  score: number;
}
