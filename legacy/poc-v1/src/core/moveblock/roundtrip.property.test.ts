import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbMoveBlock } from '../test/arbitraries';
import {
  createDefaultRegistry,
  equivalentMoveBlocks,
  parseMoveBlock,
  printMoveBlock,
  PrimitiveRegistry,
  DEFAULT_PRIMITIVE_DESCRIPTORS,
  validateMoveBlockValue,
} from './index';

const registry = createDefaultRegistry();

// A registry with an extra primitive (boolean and optional parameters), to check the
// generator follows the registry's schemas rather than a fixed list.
const extendedRegistry = (() => {
  const r = new PrimitiveRegistry();
  for (const d of DEFAULT_PRIMITIVE_DESCRIPTORS) r.register(d);
  r.register({
    name: 'test_flourish',
    version: 1,
    paramSchema: [
      { name: 'mirrored', type: 'boolean', required: true },
      { name: 'scale', type: 'number', required: false, min: -2, max: 2 },
      { name: 'repeats', type: 'integer', required: false, min: 0, max: 3 },
    ],
  });
  return r;
})();

describe('Move_Block round trip', () => {
  // Feature: mythic-strings-shadow-puppet-battle, Property 1: Move_Block print/parse round trip
  // **Validates: Requirements 12.1, 13.1, 13.3, 13.4**
  it.each([
    ['default registry', registry],
    ['registry with an extra primitive', extendedRegistry],
  ])('print then parse returns an equivalent Move_Block (%s)', (_label, reg) => {
    fc.assert(
      fc.property(arbMoveBlock(reg), (block) => {
        const printed = printMoveBlock(block, reg);
        expect(printed.ok).toBe(true);
        if (!printed.ok) return;

        // The printed document conforms to the schema and keeps invocation order.
        const doc: unknown = JSON.parse(printed.value);
        expect(validateMoveBlockValue(doc, reg).ok).toBe(true);
        expect((doc as { primitives: { primitive: string }[] }).primitives.map((p) => p.primitive)).toEqual(
          block.primitives.map((p) => p.primitive),
        );

        const parsed = parseMoveBlock(printed.value, reg);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(equivalentMoveBlocks(parsed.value, block)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('respects generator options for small blocks', () => {
    fc.assert(
      fc.property(
        arbMoveBlock(registry, {
          maxPrimitives: 2,
          primitiveNames: ['projectile_volley'],
          paramRanges: { projectile_volley: { count: { max: 5 } } },
        }),
        (block) => {
          expect(block.primitives.length).toBeLessThanOrEqual(2);
          for (const inv of block.primitives) {
            expect(inv.primitive).toBe('projectile_volley');
            expect(inv.params.count).toBeLessThanOrEqual(5);
          }
          expect(validateMoveBlockValue(block, registry).ok).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
