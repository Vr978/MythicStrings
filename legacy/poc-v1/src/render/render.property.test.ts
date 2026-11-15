import fc from 'fast-check';
import { Container } from 'pixi.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARJUN, ARJUN_VS_DURYODHAN, KURUKSHETRA_STAGE } from '../content/scenarios/arjunVsDuryodhan';
import type { Ornament, PuppetCharacter, Vec2 } from '../core/scenario/types';
import { SimWorld } from '../sim/world';
import { effectVisual } from './effectShapes';
import { buildSegmentGeometry } from './geometry';
import { createStageLayout, isInsideStage, worldToStagePx } from './layout';
import { ornamentStrokes, strokesBounds } from './ornaments';
import { PivotLayer } from './pivots';
import { PuppetView } from './puppet';
import { ALPHA_MAX, ALPHA_MIN, hexToRgb, luminance, multiplyOver, type Rgb } from './style';

const NUM_RUNS = { numRuns: 100 };

const arbOpacity = fc.oneof(fc.double({ noNaN: false }), fc.constantFrom(-1, 0, 0.3, 0.9, 1, 5));

/** Convex polygon: n >= 4 points on a circle with random angular gaps, plus its inradius. */
const arbConvexWithInradius = (cx: number, cy: number, r: number) =>
  fc
    .array(fc.double({ min: 0.5, max: 1, noNaN: true }), { minLength: 4, maxLength: 10 })
    .map((gaps) => {
      const total = gaps.reduce((a, b) => a + b, 0);
      const maxGap = (Math.max(...gaps) / total) * Math.PI * 2; // at most 144 degrees
      let acc = 0;
      const points = gaps.map((g) => {
        const a = (acc / total) * Math.PI * 2;
        acc += g;
        return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
      });
      return { points, inradius: r * Math.cos(maxGap / 2) };
    });
const arbConvex = (cx: number, cy: number, r: number) => arbConvexWithInradius(cx, cy, r).map((c) => c.points);

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

describe('render model properties', () => {
  beforeAll(async () => {
    await SimWorld.init();
  });

  // Feature: mythic-strings-shadow-puppet-battle, Property 51: Segment count and opacity
  // **Validates: Requirements 1.1, 1.6**
  it('Property 51: every segment and effect has 2..20 segments and opacity in [0.3, 0.9]', () => {
    const kinds = ['arrow', 'spear', 'disc', 'stone', 'fireball', 'boulder', 'mace', 'wall', 'chariot_wheel', 'serpent', 'clone', 'object'];
    fc.assert(
      fc.property(
        fc.array(arbOpacity, { minLength: ARJUN.rig.segments.length, maxLength: ARJUN.rig.segments.length }),
        fc.constantFrom(...kinds),
        fc.oneof(
          fc.record({ type: fc.constant('ball' as const), radius: fc.double({ min: 0.01, max: 1, noNaN: true }) }),
          fc.record({
            type: fc.constant('cuboid' as const),
            hx: fc.double({ min: 0.01, max: 1, noNaN: true }),
            hy: fc.double({ min: 0.01, max: 1, noNaN: true }),
          }),
        ),
        (opacities, kind, shape) => {
          const character: PuppetCharacter = {
            ...ARJUN,
            appearance: {
              ...ARJUN.appearance,
              segments: ARJUN.appearance.segments.map((a, i) => ({ ...a, opacity: opacities[i] ?? 0.5 })),
            },
          };
          const view = new PuppetView(character);
          expect(view.segments.size).toBeGreaterThanOrEqual(2);
          expect(view.segments.size).toBeLessThanOrEqual(20);
          for (const s of view.segments.values()) {
            expect(s.mesh.alpha).toBeGreaterThanOrEqual(ALPHA_MIN);
            expect(s.mesh.alpha).toBeLessThanOrEqual(ALPHA_MAX);
          }
          view.destroy();
          const v = effectVisual(kind, shape, '#3f7a5a');
          expect(v.alpha).toBeGreaterThanOrEqual(ALPHA_MIN);
          expect(v.alpha).toBeLessThanOrEqual(ALPHA_MAX);
          expect(v.parts.length).toBeGreaterThan(0);
        },
      ),
      NUM_RUNS,
    );
  });

  // Feature: mythic-strings-shadow-puppet-battle, Property 52: Pivot markers at visible joints
  // **Validates: Requirements 1.2**
  it('Property 52: rivets match visible joints one-to-one at their screen positions', () => {
    const base = SimWorld.create(KURUKSHETRA_STAGE, ARJUN_VS_DURYODHAN.characters, 11);
    const snapshot = base.snapshot();
    base.free();
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 16, noNaN: true }),
        fc.double({ min: 1, max: 9, noNaN: true }),
        fc.integer({ min: 0, max: 9 }),
        fc.record({ x: fc.double({ min: -3, max: 3, noNaN: true }), y: fc.double({ min: -1, max: 3, noNaN: true }) }),
        fc.integer({ min: 0, max: 40 }),
        (width, height, segIndex, impulse, steps) => {
          const world = SimWorld.fromSnapshot(snapshot);
          try {
            const target = ARJUN.rig.segments[segIndex]!.id;
            world.applySegmentImpulse('arjun', target, impulse);
            world.applySegmentImpulse('duryodhan', target, { x: -impulse.x, y: impulse.y });
            for (let i = 0; i < steps; i++) world.step();
            const layout = createStageLayout({ width, height, floorY: 0 });
            const layer = new Container();
            const pivots = new PivotLayer(layer, layout);
            for (const c of ARJUN_VS_DURYODHAN.characters) {
              const segs = new Map(c.rig.segments.map((s) => [s.id, world.segmentTransform(c.id, s.id)]));
              pivots.update(c.id, c.rig, world.ragdoll(c.id).facing, segs);
              const rivets = pivots.rivetsOf(c.id);
              const joints = world.ragdoll(c.id).joints;
              expect(rivets.length).toBe(joints.length);
              joints.forEach((j, i) => {
                const joint = world.world.getImpulseJoint(j.handle);
                const b = joint.body1();
                const a = joint.anchor1();
                const ang = b.rotation();
                const t = b.translation();
                const p = worldToStagePx(layout, {
                  x: t.x + a.x * Math.cos(ang) - a.y * Math.sin(ang),
                  y: t.y + a.x * Math.sin(ang) + a.y * Math.cos(ang),
                });
                const inside = isInsideStage(layout, p);
                // Allow boundary jitter of float32 physics vs float64 math.
                const nearEdge =
                  Math.min(Math.abs(p.x), Math.abs(p.x - layout.widthPx), Math.abs(p.y), Math.abs(p.y - layout.heightPx)) < 1e-2;
                if (!nearEdge) expect(rivets[i]!.visible).toBe(inside);
                if (rivets[i]!.visible) {
                  expect(Math.abs(rivets[i]!.position.x - p.x)).toBeLessThan(0.05);
                  expect(Math.abs(rivets[i]!.position.y - p.y)).toBeLessThan(0.05);
                }
              });
            }
            pivots.destroy();
          } finally {
            world.free();
          }
        },
      ),
      NUM_RUNS,
    );
  });

  // Feature: mythic-strings-shadow-puppet-battle, Property 53: Overlaps are darker
  // **Validates: Requirements 1.3**
  it('Property 53: two overlapping multiply segments are darker than either alone', () => {
    const channel = fc.integer({ min: 0, max: 254 });
    const arbColor = fc.tuple(channel, channel, channel).map(([r, g, b]) => (r << 16) | (g << 8) | b);
    const arbAlpha = fc.double({ min: ALPHA_MIN, max: ALPHA_MAX, noNaN: true });
    const arbLight = fc
      .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
      .filter(([r, g, b]) => r + g + b > 0)
      .map(([r, g, b]) => (r << 16) | (g << 8) | b);
    fc.assert(
      fc.property(arbLight, arbColor, arbAlpha, arbColor, arbAlpha, (light, c1, a1, c2, a2) => {
        const bg: Rgb = hexToRgb(light);
        const one = multiplyOver(bg, hexToRgb(c1), a1);
        const two = multiplyOver(bg, hexToRgb(c2), a2);
        const both = multiplyOver(one, hexToRgb(c2), a2);
        const bothReversed = multiplyOver(two, hexToRgb(c1), a1);
        expect(luminance(both)).toBeLessThan(luminance(one));
        expect(luminance(both)).toBeLessThan(luminance(two));
        expect(luminance(bothReversed)).toBeCloseTo(luminance(both), 12);
      }),
      NUM_RUNS,
    );
  });

  // Feature: mythic-strings-shadow-puppet-battle, Property 54: Perforations are open
  // **Validates: Requirements 1.4**
  it('Property 54: triangulation covers no point strictly inside a hole; ornaments sit at their positions', () => {
    const arbCase = fc
      .record({
        cx: fc.double({ min: -1, max: 1, noNaN: true }),
        cy: fc.double({ min: -1, max: 1, noNaN: true }),
        r: fc.double({ min: 0.05, max: 0.6, noNaN: true }),
        hx: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
        hy: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
        hr: fc.double({ min: 0.05, max: 0.3, noNaN: true }),
      })
      .chain(({ cx, cy, r, hx, hy, hr }) =>
        arbConvexWithInradius(cx, cy, r).chain(({ points, inradius }) => {
          // The outline contains the concentric disc of radius `inradius`; keep the hole well inside it.
          const holeR = (inradius / 2) * hr;
          const hcx = cx + hx * (inradius / 2);
          const hcy = cy + hy * (inradius / 2);
          return fc.tuple(
            fc.constant(points),
            arbConvex(hcx, hcy, holeR),
            fc.array(fc.tuple(fc.double({ min: 0.05, max: 0.95, noNaN: true }), fc.nat()), { minLength: 1, maxLength: 8 }),
          );
        }),
      );
    const arbOrnament: fc.Arbitrary<Ornament> = fc.record({
      pattern: fc.constantFrom('dots', 'zigzag', 'floral', 'scale'),
      position: fc.record({ x: fc.double({ min: -1, max: 1, noNaN: true }), y: fc.double({ min: -1, max: 1, noNaN: true }) }),
      scale: fc.double({ min: 0.01, max: 0.5, noNaN: true }),
    });
    fc.assert(
      fc.property(arbCase, arbOrnament, ([outline, hole, samples], ornament) => {
        const g = buildSegmentGeometry({ outline }, { perforations: [hole] });
        expect(g.fallbackReason).toBeNull();
        expect(g.holes).toHaveLength(1);
        const hc = { x: hole.reduce((s, p) => s + p.x, 0) / hole.length, y: hole.reduce((s, p) => s + p.y, 0) / hole.length };
        const pts = g.positions;
        for (const [t, k] of samples) {
          // Strictly interior point of the convex hole: shrink a vertex toward the centroid.
          const v = hole[k % hole.length]!;
          const p = { x: hc.x + (v.x - hc.x) * t * 0.95, y: hc.y + (v.y - hc.y) * t * 0.95 };
          for (let i = 0; i < g.indices.length; i += 3) {
            const a = { x: pts[g.indices[i]! * 2]!, y: pts[g.indices[i]! * 2 + 1]! };
            const b = { x: pts[g.indices[i + 1]! * 2]!, y: pts[g.indices[i + 1]! * 2 + 1]! };
            const c = { x: pts[g.indices[i + 2]! * 2]!, y: pts[g.indices[i + 2]! * 2 + 1]! };
            const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
            if (area < 1e-14) continue;
            expect(pointInTriangle(p, a, b, c)).toBe(false);
          }
        }
        const bounds = strokesBounds(ornamentStrokes(ornament));
        const tol = 1e-9 * Math.max(1, ornament.scale);
        expect(Math.abs((bounds.minX + bounds.maxX) / 2 - ornament.position.x)).toBeLessThan(tol + 1e-12);
        expect(Math.abs((bounds.minY + bounds.maxY) / 2 - ornament.position.y)).toBeLessThan(tol + 1e-12);
      }),
      NUM_RUNS,
    );
  });

  // Feature: mythic-strings-shadow-puppet-battle, Property 55: Bad perforation data falls back to a solid segment
  // **Validates: Requirements 1.5**
  it('Property 55: missing, self-intersecting, or out-of-bounds perforations give the plain outline', () => {
    const arbBad = fc
      .tuple(arbConvex(0, 0, 0.5), fc.double({ min: 0.02, max: 0.1, noNaN: true }), fc.double({ min: 0.6, max: 3, noNaN: true }), fc.double({ min: 0, max: Math.PI * 2, noNaN: true }))
      .chain(([outline, s, d, ang]) => {
        const bowtie: Vec2[] = [
          { x: -s, y: -s },
          { x: s, y: s },
          { x: s, y: -s },
          { x: -s, y: s },
        ];
        const outside: Vec2[] = [
          { x: Math.cos(ang) * d - s, y: Math.sin(ang) * d - s },
          { x: Math.cos(ang) * d + s, y: Math.sin(ang) * d - s },
          { x: Math.cos(ang) * d, y: Math.sin(ang) * d + s },
        ];
        return fc.tuple(
          fc.constant(outline),
          fc.constantFrom<unknown>(undefined, [], [bowtie], [outside], [bowtie, outside], [[{ x: 0, y: 0 }]], 'junk', [[{ x: Number.NaN, y: 0 }, { x: 0, y: 0 }, { x: 0, y: s }]]),
        );
      });
    fc.assert(
      fc.property(arbBad, ([outline, perforations]) => {
        const plain = buildSegmentGeometry({ outline }, null);
        const g = buildSegmentGeometry({ outline }, { perforations: perforations as Vec2[][] | undefined });
        expect(g.positions).toEqual(plain.positions);
        expect(g.indices).toEqual(plain.indices);
        expect(g.holes).toEqual([]);
        expect(g.outline).toEqual(outline);
      }),
      NUM_RUNS,
    );
  });
});
