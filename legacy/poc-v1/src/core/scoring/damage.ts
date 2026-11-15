// Damage_Scorer pure formula (design: "Damage_Scorer"). No I/O; the judge adapter lives in src/ai/judge.ts.

/**
 * Hit totals for one Puppet_Character over a simulated Move.
 * Structurally identical to `CharacterHit` from src/sim/world.ts (`hitTotals()`).
 */
export interface HitResult {
  characterId: string;
  contactCount: number;
  /** Sum of contact impulses on the character, in N·s. */
  totalImpulse: number;
}

export interface ScoreInputs {
  /** Hit totals of the Move's primary target. */
  targetHit: HitResult;
  /** Creativity_Score in [0, 1]. */
  creativity: number;
  /** Trait alignment in [0, 1]. */
  traitAlignment: number;
  /** Vote_Share in [0, 1]. */
  voteShare: number;
}

/** Each criterion's share of the unrounded raw score (Req 15.4). */
export interface ScoreContributions {
  hit: number;
  creativity: number;
  traitAlignment: number;
  voteShare: number;
}

export interface ScoreBreakdown {
  /** Integer Damage_Score in [0, 30] (Req 15.2). */
  damage: number;
  /** Unrounded raw score; equals the sum of `contributions`. */
  raw: number;
  contributions: ScoreContributions;
}

export const MAX_DAMAGE = 30;
/** Vote_Share used when no votes were accepted or voting is disabled (Req 15.9, 16.8, 16.9). */
export const NEUTRAL_VOTE_SHARE = 0.5;
/** Creativity_Score used for every Fallback_Move (Req 17.4). */
export const FALLBACK_CREATIVITY = 0;

/**
 * Impulse (N·s) at which the hit factor saturates at 1. PoC puppets weigh about 0.73 kg and
 * contact impulses are roughly 0.1 to 5 N·s, so a reference of 4 N·s keeps typical hits meaningful.
 */
export const IMPULSE_REF = 4;

/** Weights of the quality multiplier; base + the three weights = 1, so quality is in [0.4, 1]. */
const BASE_WEIGHT = 0.4;
const CRITERION_WEIGHT = 0.2;

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const clampInt = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.trunc(x)));

/**
 * Hit strength in [0, 1]: 0 without contact, otherwise sqrt(impulse / IMPULSE_REF) capped at 1.
 * The square root (a deliberate calibration over the design's linear sketch) lifts small but real
 * hits: 0.25 N·s gives 0.25, 1 N·s gives 0.5, 4 N·s or more gives 1. It is still monotonic.
 */
export function hitFactor(hit: HitResult): number {
  if (!(hit.contactCount > 0)) return 0;
  const impulse = Number.isFinite(hit.totalImpulse) ? Math.max(0, hit.totalImpulse) : 0;
  return Math.min(1, Math.sqrt(impulse / IMPULSE_REF));
}

/**
 * Damage_Score = floor(30 · h · (0.4 + 0.2·creativity + 0.2·trait + 0.2·vote)), clamped to [0, 30].
 * Pure and deterministic (Req 15.5); non-decreasing in Vote_Share (Req 15.6); 0 without contact (Req 15.7).
 */
export function damageScore(i: ScoreInputs): ScoreBreakdown {
  const scale = MAX_DAMAGE * hitFactor(i.targetHit);
  const contributions: ScoreContributions = {
    hit: scale * BASE_WEIGHT,
    creativity: scale * CRITERION_WEIGHT * clamp01(i.creativity),
    traitAlignment: scale * CRITERION_WEIGHT * clamp01(i.traitAlignment),
    voteShare: scale * CRITERION_WEIGHT * clamp01(i.voteShare),
  };
  const raw = contributions.hit + contributions.creativity + contributions.traitAlignment + contributions.voteShare;
  const damage = i.targetHit.contactCount > 0 ? clampInt(Math.floor(raw + 1e-9), 0, MAX_DAMAGE) : 0;
  return { damage, raw, contributions };
}

/** Hit-only Damage_Score used when the judge fails or times out (Req 15.10). */
export function fallbackDamageScore(hit: HitResult): number {
  return clampInt(Math.floor(MAX_DAMAGE * hitFactor(hit) * 0.6 + 1e-9), 0, MAX_DAMAGE);
}

/**
 * Creativity_Score for one use of a Move_Library entry by a Player (Req 15.3).
 * First use (`previous` undefined) returns `raw`; a repeat use returns min(raw, previous / 2),
 * which is strictly below `previous` when it is above 0, and 0 when `previous` is 0.
 */
export function creativityForUse(raw: number, previous: number | undefined): number {
  const r = clamp01(raw);
  if (previous === undefined) return r;
  const p = clamp01(previous);
  if (p === 0) return 0;
  return Math.min(r, p * 0.5);
}
