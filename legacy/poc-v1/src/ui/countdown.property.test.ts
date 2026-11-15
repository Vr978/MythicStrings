import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countdownSeconds } from './moveInput';

describe('countdownSeconds', () => {
  // Feature: mythic-strings-shadow-puppet-battle, Property 33: Countdown display
  // **Validates: Requirements 7.2**
  it('equals ceil(remaining / 1000), never increases, and is 0 exactly at the deadline', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 60_000 }),
        fc.array(fc.integer({ min: 0, max: 60_000 }), { maxLength: 40 }),
        (start, duration, offsets) => {
          const deadline = start + duration;
          const readings = [...new Set(offsets.map((o) => start + (o % duration)))].sort((a, b) => a - b);
          let last = Infinity;
          for (const now of readings) {
            const shown = countdownSeconds(deadline, now);
            expect(shown).toBe(Math.ceil((deadline - now) / 1000));
            expect(shown).toBeGreaterThan(0);
            expect(shown).toBeLessThanOrEqual(last);
            last = shown;
          }
          expect(countdownSeconds(deadline, deadline)).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
