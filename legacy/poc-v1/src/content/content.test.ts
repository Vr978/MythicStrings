import { describe, expect, it } from 'vitest';
import { parseMoveBlock, printMoveBlock } from '../core/moveblock';
import { createDefaultRegistry, SEGMENT_ROLES as PRIMITIVE_SEGMENT_ROLES } from '../core/moveblock/primitiveSchemas';
import { traitBalanceOk, traitMagnitudeSum, validateTraitSet } from '../core/scenario/traits';
import { SEGMENT_ROLES, STARTING_HP, type RigSpec } from '../core/scenario/types';
import { FALLBACK_MOVES } from './fallbacks';
import { BLOCKED_LEXICON, DEROGATORY_CATEGORIES } from './lexicon';
import { DEFAULT_HUMANOID_RIG, resolveRig, validateRig } from './rig';
import { ARJUN_VS_DURYODHAN } from './scenarios/arjunVsDuryodhan';

const clone = (r: RigSpec): RigSpec => structuredClone(r);

describe('rig', () => {
  it('default rig has 10 valid segments with shins as feet', () => {
    expect(DEFAULT_HUMANOID_RIG.segments).toHaveLength(10);
    expect(validateRig(DEFAULT_HUMANOID_RIG).ok).toBe(true);
    const feet = DEFAULT_HUMANOID_RIG.segments.filter((s) => s.isFoot).map((s) => s.role);
    expect(feet).toEqual(['shin', 'shin']);
    for (const j of DEFAULT_HUMANOID_RIG.joints) expect(j.lowerRad).toBeLessThanOrEqual(j.upperRad);
  });

  it('resolveRig keeps a valid custom rig', () => {
    const custom = clone(DEFAULT_HUMANOID_RIG);
    custom.segments = custom.segments.slice(0, 6);
    custom.joints = custom.joints.filter(
      (j) => custom.segments.some((s) => s.id === j.parent) && custom.segments.some((s) => s.id === j.child),
    );
    expect(resolveRig(custom)).toBe(custom);
  });

  it('resolveRig falls back to the default rig for invalid input', () => {
    const tooFew = clone(DEFAULT_HUMANOID_RIG);
    tooFew.segments = tooFew.segments.slice(0, 5);
    tooFew.joints = [];
    const inverted = clone(DEFAULT_HUMANOID_RIG);
    inverted.joints[0] = { ...inverted.joints[0]!, lowerRad: 1, upperRad: -1 };
    const missingLimit = clone(DEFAULT_HUMANOID_RIG) as unknown as { joints: Record<string, unknown>[] };
    delete missingLimit.joints[1]!.upperRad;
    const tooMany = clone(DEFAULT_HUMANOID_RIG);
    tooMany.segments = Array.from({ length: 21 }, (_, i) => ({ ...tooMany.segments[0]!, id: `s${i}` }));
    tooMany.joints = [];
    for (const bad of [tooFew, inverted, missingLimit, tooMany, null, 'rig', {}]) {
      expect(resolveRig(bad)).toBe(DEFAULT_HUMANOID_RIG);
    }
  });

  it('segment roles match the apply_impulse enum', () => {
    expect([...SEGMENT_ROLES]).toEqual([...PRIMITIVE_SEGMENT_ROLES]);
  });
});

describe('Arjun vs Duryodhan scenario', () => {
  const s = ARJUN_VS_DURYODHAN;

  it('has valid, balanced traits, 100 HP, and resolved rigs', () => {
    expect(s.characters.map((c) => c.name)).toEqual(['Arjun', 'Duryodhan']);
    expect(s.characters.map((c) => traitMagnitudeSum(c.traits))).toEqual([24, 23]);
    expect(traitBalanceOk(s)).toBe(true);
    for (const c of s.characters) {
      expect(validateTraitSet(c.traits).ok).toBe(true);
      expect(c.startingHP).toBe(STARTING_HP);
      expect(resolveRig(c.rig)).toBe(c.rig);
    }
  });

  it('art covers every segment with opacity in [0.3, 0.9] and includes perforations and ornaments', () => {
    for (const c of s.characters) {
      const ids = c.rig.segments.map((seg) => seg.id).sort();
      expect(c.appearance.segments.map((a) => a.segmentId).sort()).toEqual(ids);
      for (const a of c.appearance.segments) {
        expect(a.opacity).toBeGreaterThanOrEqual(0.3);
        expect(a.opacity).toBeLessThanOrEqual(0.9);
      }
      expect(c.appearance.segments.some((a) => (a.perforations?.length ?? 0) > 0)).toBe(true);
      expect(c.appearance.segments.some((a) => (a.ornaments?.length ?? 0) > 0)).toBe(true);
    }
  });
});

describe('fallback moves', () => {
  it('has at least 4 blocks that the Move_Printer and Move_Parser accept under the default registry', () => {
    expect(FALLBACK_MOVES.length).toBeGreaterThanOrEqual(4);
    const registry = createDefaultRegistry();
    for (const block of FALLBACK_MOVES) {
      const printed = printMoveBlock(block, registry);
      expect(printed.ok, `${block.displayName}: ${printed.ok ? '' : `${printed.error.path} ${printed.error.reason}`}`).toBe(true);
      if (printed.ok) expect(parseMoveBlock(printed.value, registry).ok, block.displayName).toBe(true);
    }
  });
});

describe('lexicon', () => {
  it('maps entries to all six categories and marks them as placeholders', () => {
    expect(new Set(BLOCKED_LEXICON.map((e) => e.category))).toEqual(new Set(DEROGATORY_CATEGORIES));
    expect(BLOCKED_LEXICON.every((e) => e.placeholder)).toBe(true);
  });
});
