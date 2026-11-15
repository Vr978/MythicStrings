// Property tests for the Damage_Scorer pure formula (src/core/scoring/damage.ts).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { damageScore, MAX_DAMAGE, type HitResult, type ScoreInputs } from './damage';

const unit = fc.double({ min: 0, max: 1, noNaN: true });

const hitArb: fc.Arbitrary<HitResult> = fc.record({
  characterId: fc.constantFrom('p1-puppet', 'p2-puppet'),
  contactCount: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 50 })),
  // Covers zero, sub-reference, and saturating impulses (IMPULSE_REF is 4 N·s).
  totalImpulse: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 20, noNaN: true })),
});

const inputsArb: fc.Arbitrary<ScoreInputs> = fc.record({
  targetHit: hitArb,
  creativity: unit,
  traitAlignment: unit,
  voteShare: unit,
});

describe('damageScore properties', () => {
  // Feature: mythic-strings-shadow-puppet-battle, Property 19: Damage bounds and no-contact rule
  // **Validates: Requirements 15.2, 15.7**
  it('returns an integer in [0, 30], and 0 when the target has no contact', () => {
    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const { damage } = damageScore(inputs);
        expect(Number.isInteger(damage)).toBe(true);
        expect(damage).toBeGreaterThanOrEqual(0);
        expect(damage).toBeLessThanOrEqual(MAX_DAMAGE);
        if (inputs.targetHit.contactCount === 0) expect(damage).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: mythic-strings-shadow-puppet-battle, Property 20: Damage is monotonic in Vote_Share
  // **Validates: Requirements 15.6**
  it('is non-decreasing in Vote_Share for fixed hit, creativity, and trait alignment', () => {
    fc.assert(
      fc.property(hitArb, unit, unit, unit, unit, (targetHit, creativity, traitAlignment, a, b) => {
        const [v1, v2] = a <= b ? [a, b] : [b, a];
        const d1 = damageScore({ targetHit, creativity, traitAlignment, voteShare: v1 }).damage;
        const d2 = damageScore({ targetHit, creativity, traitAlignment, voteShare: v2 }).damage;
        expect(d1).toBeLessThanOrEqual(d2);
      }),
      { numRuns: 100 },
    );
  });
});
