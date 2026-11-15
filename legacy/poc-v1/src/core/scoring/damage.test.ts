import { describe, expect, it } from 'vitest';
import {
  FALLBACK_CREATIVITY,
  creativityForUse,
  damageScore,
  fallbackDamageScore,
  hitFactor,
  type HitResult,
} from './damage';

const hit = (totalImpulse: number, contactCount = 3): HitResult => ({ characterId: 'duryodhan', contactCount, totalImpulse });

describe('hitFactor', () => {
  it('is 0 without contact even with impulse', () => {
    expect(hitFactor(hit(10, 0))).toBe(0);
  });
  it('grows with impulse and saturates at 1', () => {
    expect(hitFactor(hit(1))).toBeCloseTo(0.5);
    expect(hitFactor(hit(4))).toBe(1);
    expect(hitFactor(hit(400))).toBe(1);
    expect(hitFactor(hit(0.25))).toBeLessThan(hitFactor(hit(1)));
  });
  it('treats negative or non-finite impulse as 0', () => {
    expect(hitFactor(hit(-3))).toBe(0);
    expect(hitFactor(hit(Number.NaN))).toBe(0);
  });
});

describe('damageScore', () => {
  it('gives 0 when the target has no contact, regardless of other inputs (Req 15.7)', () => {
    const r = damageScore({ targetHit: hit(5, 0), creativity: 1, traitAlignment: 1, voteShare: 1 });
    expect(r.damage).toBe(0);
    expect(r.raw).toBe(0);
  });

  it('gives 30 for a saturating hit with perfect scores and stays within 0..30 (Req 15.2)', () => {
    expect(damageScore({ targetHit: hit(50), creativity: 1, traitAlignment: 1, voteShare: 1 }).damage).toBe(30);
    expect(damageScore({ targetHit: hit(50), creativity: 0, traitAlignment: 0, voteShare: 0 }).damage).toBe(12);
  });

  it('gives meaningful damage for typical PoC impulses', () => {
    const typical = { creativity: 0.6, traitAlignment: 0.9, voteShare: 0.5 };
    const strike = damageScore({ targetHit: hit(2), ...typical }).damage;
    const volley = damageScore({ targetHit: hit(4), ...typical }).damage;
    expect(strike).toBeGreaterThanOrEqual(10);
    expect(volley).toBeGreaterThanOrEqual(15);
    expect(volley).toBeLessThanOrEqual(25);
  });

  it('reports contributions that sum to the unrounded raw score (Req 15.4)', () => {
    const r = damageScore({ targetHit: hit(1.7), creativity: 0.3, traitAlignment: 0.8, voteShare: 0.65 });
    const c = r.contributions;
    expect(c.hit + c.creativity + c.traitAlignment + c.voteShare).toBeCloseTo(r.raw, 12);
    expect(r.damage).toBe(Math.floor(r.raw));
    expect(Number.isInteger(r.damage)).toBe(true);
  });

  it('is deterministic and non-decreasing in Vote_Share (Req 15.5, 15.6)', () => {
    const base = { targetHit: hit(2.5), creativity: 0.5, traitAlignment: 0.5 };
    expect(damageScore({ ...base, voteShare: 0.4 })).toEqual(damageScore({ ...base, voteShare: 0.4 }));
    expect(damageScore({ ...base, voteShare: 1 }).damage).toBeGreaterThanOrEqual(
      damageScore({ ...base, voteShare: 0 }).damage,
    );
  });

  it('clamps out-of-range criterion inputs', () => {
    const r = damageScore({ targetHit: hit(50), creativity: 7, traitAlignment: -2, voteShare: Number.NaN });
    expect(r.damage).toBe(18);
  });
});

describe('fallbackDamageScore (Req 15.10)', () => {
  it('uses only hit results, is deterministic, and is 0 without contact', () => {
    expect(fallbackDamageScore(hit(50))).toBe(18);
    expect(fallbackDamageScore(hit(1))).toBe(fallbackDamageScore(hit(1)));
    expect(fallbackDamageScore(hit(1))).toBe(9);
    expect(fallbackDamageScore(hit(9, 0))).toBe(0);
  });
});

describe('creativityForUse (Req 15.3, 17.4)', () => {
  it('returns raw on first use', () => {
    expect(creativityForUse(0.8, undefined)).toBe(0.8);
  });
  it('halves on each repeat use', () => {
    const first = creativityForUse(0.8, undefined);
    const second = creativityForUse(0.8, first);
    const third = creativityForUse(0.9, second);
    expect(second).toBe(0.4);
    expect(third).toBe(0.2);
  });
  it('uses the lower raw score when it is below half the previous', () => {
    expect(creativityForUse(0.1, 0.8)).toBe(0.1);
  });
  it('stays 0 once it reaches 0', () => {
    expect(creativityForUse(1, 0)).toBe(0);
  });
  it('fallback creativity is 0', () => {
    expect(FALLBACK_CREATIVITY).toBe(0);
  });
});
