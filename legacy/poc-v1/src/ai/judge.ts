// Judge adapter for the Damage_Scorer (design: "Damage_Scorer + judge adapter").
// The judge only produces raw creativity and Trait alignment, both in [0, 1]. The PoC uses a local
// keyword heuristic; an LLM-backed judge can implement the same interface later.
import type { MoveBlock } from '../core/moveblock/types';
import type { Trait } from '../core/scenario/types';

export interface JudgeContext {
  /** Traits of the acting Puppet_Character. */
  traits: readonly Trait[];
  /** Move_Prompt the Player typed, when there is one. */
  prompt?: string;
  /** Move_Blocks already performed earlier in this Battle (any Player), oldest first. */
  history: readonly MoveBlock[];
}

export interface JudgeScores {
  creativity: number;
  traitAlignment: number;
}

export interface Judge {
  score(move: MoveBlock, ctx: JudgeContext): Promise<JudgeScores>;
}

/** Judge deadline before the Damage_Scorer switches to `fallbackDamageScore` (Req 15.10). */
export const JUDGE_TIMEOUT_MS = 4000;

/**
 * Runs the judge with a deadline. Resolves to `null` when the judge rejects or misses the deadline,
 * which tells the caller to use `fallbackDamageScore` and notify both Players (Req 15.10).
 */
export async function scoreWithTimeout(
  judge: Judge,
  move: MoveBlock,
  ctx: JudgeContext,
  timeoutMs: number = JUDGE_TIMEOUT_MS,
): Promise<JudgeScores | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const scores = await Promise.race([judge.score(move, ctx).catch(() => null), timeout]);
    if (!scores) return null;
    return { creativity: clamp01(scores.creativity), traitAlignment: clamp01(scores.traitAlignment) };
  } finally {
    clearTimeout(timer);
  }
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Concept groups linking Move vocabulary to Trait vocabulary. Tokens are stemmed (see `stem`) before lookup,
 * so "arrows" and "archers" both match. A Trait aligns with a Move when they share a concept or a word.
 */
const CONCEPTS: Readonly<Record<string, readonly string[]>> = {
  archery: ['arrow', 'archer', 'archery', 'bow', 'bowman', 'volley', 'projectile', 'shoot', 'loose', 'quiver', 'aim'],
  mace: ['mace', 'gada', 'club', 'cudgel', 'smash', 'crush', 'bludgeon', 'swing'],
  strength: ['strength', 'strong', 'might', 'mighty', 'power', 'force', 'impulse', 'boulder', 'heavy'],
  divine: ['divine', 'celestial', 'astra', 'god', 'gods', 'fireball', 'fire', 'blessed', 'heavenly'],
  focus: ['focus', 'precise', 'precision', 'accuracy', 'accurate', 'eye', 'target'],
  illusion: ['clone', 'illusion', 'maya', 'mirror', 'shadow', 'hair', 'trick', 'deceive', 'duplicate'],
  endurance: ['endurance', 'endure', 'resilience', 'tough', 'wall', 'shield', 'guard', 'stand'],
  summoning: ['summon', 'conjure', 'serpent', 'chariot', 'wheel', 'spawn'],
  speed: ['speed', 'swift', 'fast', 'quick', 'rapid', 'charge', 'lunge'],
  spear: ['spear', 'javelin', 'lance', 'throw', 'disc', 'chakra', 'stone'],
};

const STOPWORDS = new Set([
  'the', 'and', 'with', 'for', 'from', 'into', 'onto', 'that', 'this', 'his', 'her', 'their', 'its', 'my',
  'your', 'our', 'all', 'one', 'two', 'can', 'who', 'are', 'was', 'not', 'never', 'only', 'after', 'other',
  'others', 'object', 'count', 'body', 'opponent', 'move', 'master',
]);

/** Light stemming so plural and simple verb forms meet: "arrows" -> "arrow", "summoned" -> "summon". */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('es') && /(ss|sh|ch|x)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

const CONCEPT_OF = new Map<string, string>();
for (const [concept, words] of Object.entries(CONCEPTS)) for (const w of words) CONCEPT_OF.set(stem(w), concept);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stem);
}

interface Vocabulary {
  words: Set<string>;
  concepts: Set<string>;
}

function vocabulary(texts: Iterable<string>): Vocabulary {
  const words = new Set<string>();
  const concepts = new Set<string>();
  for (const t of texts) {
    for (const w of tokens(t)) {
      words.add(w);
      const c = CONCEPT_OF.get(w);
      if (c) concepts.add(c);
    }
  }
  return { words, concepts };
}

/** Primitive names, string parameter values, display name, description, and prompt of a Move. */
function moveTexts(move: MoveBlock, prompt: string | undefined): string[] {
  const texts = [move.displayName, move.description];
  for (const inv of move.primitives) {
    texts.push(inv.primitive);
    for (const v of Object.values(inv.params)) if (typeof v === 'string') texts.push(v);
  }
  if (prompt) texts.push(prompt);
  return texts;
}

const primitiveSignature = (move: MoveBlock): string => move.primitives.map((p) => p.primitive).join('>');

/**
 * Local keyword judge.
 * - creativity = 0.4 · complexity + 0.6 · novelty, where complexity grows with the number of primitives
 *   and distinct primitives, and novelty is the share of the Move's distinct primitives not seen earlier
 *   in the Battle (halved again if the exact primitive sequence was already used).
 * - traitAlignment = min(1, Σ magnitude of aligned Traits / 10): one magnitude-9 Trait match gives 0.9.
 */
export class KeywordJudge implements Judge {
  async score(move: MoveBlock, ctx: JudgeContext): Promise<JudgeScores> {
    return { creativity: this.creativity(move, ctx.history), traitAlignment: this.traitAlignment(move, ctx) };
  }

  creativity(move: MoveBlock, history: readonly MoveBlock[]): number {
    const names = move.primitives.map((p) => p.primitive);
    const distinct = new Set(names);
    if (distinct.size === 0) return 0;
    const complexity = Math.min(1, (names.length + distinct.size) / 6);

    const seen = new Set<string>();
    for (const h of history) for (const p of h.primitives) seen.add(p.primitive);
    let fresh = 0;
    for (const n of distinct) if (!seen.has(n)) fresh++;
    let novelty = 0.3 + 0.7 * (fresh / distinct.size);
    const sig = primitiveSignature(move);
    if (history.some((h) => primitiveSignature(h) === sig)) novelty *= 0.5;

    return clamp01(0.4 * complexity + 0.6 * novelty);
  }

  traitAlignment(move: MoveBlock, ctx: Pick<JudgeContext, 'traits' | 'prompt'>): number {
    const mv = vocabulary(moveTexts(move, ctx.prompt));
    let aligned = 0;
    for (const trait of ctx.traits) {
      const tv = vocabulary([trait.name]);
      const hit =
        [...tv.concepts].some((c) => mv.concepts.has(c)) || [...tv.words].some((w) => mv.words.has(w));
      if (hit) aligned += trait.magnitude;
    }
    return clamp01(aligned / 10);
  }
}
