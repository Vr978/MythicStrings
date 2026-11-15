// Recommendation_Engine adapter (design: "Recommendation_Engine"). Async so a server-side engine can
// replace `LocalRecommendationEngine`. The 500 ms / 300 ms deadlines (Req 8.3, 8.5, 8.6) are the
// caller's job; an empty result means the matching list is empty (Req 8.7).
import type { LibraryEntry } from '../core/library/types';
import { MAX_RECOMMENDATIONS, rankRecommendations, type RecommendationContext } from '../core/recommend/rank';
import type { MoveLibrary } from './moveLibrary';

export type { RecommendationContext } from '../core/recommend/rank';

export interface RecommendationEngine {
  /** Up to 5 entries ranked by relevance for a newly opened Move_Input_Window (Req 8.1). */
  forWindow(ctx: RecommendationContext): Promise<LibraryEntry[]>;
  /** Up to 5 entries by Similarity_Score to the typed prompt; empty for a blank prompt (Req 8.5). */
  forTyping(prompt: string): Promise<LibraryEntry[]>;
}

export class LocalRecommendationEngine implements RecommendationEngine {
  readonly #library: MoveLibrary;

  constructor(library: MoveLibrary) {
    this.#library = library;
  }

  async forWindow(ctx: RecommendationContext): Promise<LibraryEntry[]> {
    const candidates = await this.#library.all();
    return rankRecommendations(candidates, ctx, MAX_RECOMMENDATIONS).map((r) => r.entry);
  }

  async forTyping(prompt: string): Promise<LibraryEntry[]> {
    if (prompt.trim().length === 0) return [];
    return this.#library.topK(prompt, MAX_RECOMMENDATIONS);
  }
}
