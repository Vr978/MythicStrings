import { beforeAll, describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { ARJUN, ARJUN_VS_DURYODHAN, KURUKSHETRA_STAGE } from '../content/scenarios/arjunVsDuryodhan';
import type { PuppetCharacter, Vec2 } from '../core/scenario/types';
import { CLONE_HALF_EXTENTS } from '../sim/primitives/spawnClones';
import { SimWorld } from '../sim/world';
import { CLONE_ALPHA, effectVisual } from './effectShapes';
import { FLICKER_AMPLITUDE, flickerAt } from './flicker';
import { buildSegmentGeometry, geometryArea, sanitizeOrnaments, signedArea } from './geometry';
import { createStageLayout, fitViewport, isInsideStage, stagePxToWorld, worldToStagePx } from './layout';
import { ornamentStrokes } from './ornaments';
import { jointAnchors, placePivot } from './pivots';
import { buildSegmentView } from './puppet';
import { cloneColorOf, PuppetRenderer } from './renderer';
import { buildStageScene } from './stage';
import { ALPHA_MAX, ALPHA_MIN, clampAlpha, parseHexColor } from './style';

const square = (cx: number, cy: number, r: number): Vec2[] => [
  { x: cx - r, y: cy - r },
  { x: cx + r, y: cy - r },
  { x: cx + r, y: cy + r },
  { x: cx - r, y: cy + r },
];
const OUTLINE = square(0, 0, 0.5);

describe('layout', () => {
  const layout = createStageLayout(KURUKSHETRA_STAGE);
  it('maps the Stage left edge at the floor to the bottom-left with a floor margin', () => {
    expect(layout.widthPx).toBe(1600);
    expect(layout.heightPx).toBe(900);
    const p = worldToStagePx(layout, { x: -8, y: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(810);
    expect(worldToStagePx(layout, { x: 0, y: 8.1 }).y).toBeCloseTo(0);
  });
  it('round-trips world and Stage pixel coordinates', () => {
    const w = stagePxToWorld(layout, worldToStagePx(layout, { x: 1.25, y: 3.5 }));
    expect(w.x).toBeCloseTo(1.25);
    expect(w.y).toBeCloseTo(3.5);
  });
  it('culls only points outside the visible Stage', () => {
    expect(isInsideStage(layout, { x: 0, y: 0 })).toBe(true);
    expect(isInsideStage(layout, { x: 1600, y: 900 })).toBe(true);
    expect(isInsideStage(layout, { x: -0.01, y: 10 })).toBe(false);
    expect(isInsideStage(layout, { x: 10, y: 900.5 })).toBe(false);
  });
  it('letterboxes the Stage into the screen', () => {
    const fit = fitViewport(layout, 1920, 1200);
    expect(fit.scale).toBeCloseTo(1.2);
    expect(fit.x).toBeCloseTo(0);
    expect(fit.y).toBeCloseTo((1200 - 1080) / 2);
  });
});

describe('style and flicker', () => {
  it('clamps opacity to [0.3, 0.9]', () => {
    expect(clampAlpha(0)).toBe(ALPHA_MIN);
    expect(clampAlpha(1)).toBe(ALPHA_MAX);
    expect(clampAlpha(0.5)).toBe(0.5);
    expect(clampAlpha(Number.NaN)).toBeGreaterThanOrEqual(ALPHA_MIN);
  });
  it('parses hex colors with a fallback', () => {
    expect(parseHexColor('#3f7a5a', 0)).toBe(0x3f7a5a);
    expect(parseHexColor('#abc', 0)).toBe(0xaabbcc);
    expect(parseHexColor('red', 7)).toBe(7);
  });
  it('flicker is slight, seeded, and deterministic', () => {
    const a = Array.from({ length: 50 }, (_, i) => flickerAt(42, i * 37));
    expect(a).toEqual(Array.from({ length: 50 }, (_, i) => flickerAt(42, i * 37)));
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(1 - FLICKER_AMPLITUDE);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(a).not.toEqual(Array.from({ length: 50 }, (_, i) => flickerAt(43, i * 37)));
  });
});

describe('buildSegmentGeometry', () => {
  const holeA = square(-0.2, 0, 0.1);
  const holeB = square(0.2, 0, 0.1);
  it('cuts perforations as holes', () => {
    const g = buildSegmentGeometry({ outline: OUTLINE }, { perforations: [holeA, holeB] });
    expect(g.fallbackReason).toBeNull();
    expect(g.holes).toHaveLength(2);
    expect(geometryArea(g)).toBeCloseTo(1 - 2 * 0.04, 9);
  });
  it('returns the plain outline without perforation data', () => {
    const g = buildSegmentGeometry({ outline: OUTLINE });
    expect(g.fallbackReason).toBeNull();
    expect(g.holes).toEqual([]);
    expect(geometryArea(g)).toBeCloseTo(1, 9);
  });
  const plain = buildSegmentGeometry({ outline: OUTLINE }, null);
  const bowtie: Vec2[] = [
    { x: -0.1, y: -0.1 },
    { x: 0.1, y: 0.1 },
    { x: 0.1, y: -0.1 },
    { x: -0.1, y: 0.1 },
  ];
  it.each([
    ['self-intersecting-hole', [bowtie]],
    ['hole-outside-outline', [square(2, 2, 0.1)]],
    ['hole-outside-outline', [square(0.45, 0, 0.1)]],
    ['overlapping-holes', [square(0, 0, 0.1), square(0.05, 0, 0.1)]],
    ['invalid-perforation', [[{ x: 0, y: 0 }, { x: 0.1, y: 0 }]]],
    ['invalid-perforation', [[{ x: Number.NaN, y: 0 }, { x: 0.1, y: 0 }, { x: 0, y: 0.1 }]]],
    ['invalid-perforation', 'not an array'],
  ])('falls back to the plain outline on %s', (reason, perforations) => {
    const g = buildSegmentGeometry({ outline: OUTLINE }, { perforations: perforations as Vec2[][] });
    expect(g.fallbackReason).toBe(reason);
    expect(g.positions).toEqual(plain.positions);
    expect(g.indices).toEqual(plain.indices);
    expect(g.outline).toEqual(OUTLINE);
  });
  it('accepts the Arjun torso perforations', () => {
    const torso = ARJUN.rig.segments.find((s) => s.id === 'torso')!;
    const art = ARJUN.appearance.segments.find((a) => a.segmentId === 'torso')!;
    const g = buildSegmentGeometry(torso, art);
    expect(g.fallbackReason).toBeNull();
    expect(g.holes).toHaveLength(3);
    expect(geometryArea(g)).toBeLessThan(Math.abs(signedArea(torso.outline)));
  });
  it('drops ornaments that cannot be drawn', () => {
    const kept = sanitizeOrnaments([
      { pattern: 'dots', position: { x: 0, y: 0 }, scale: 0.1 },
      { pattern: 'spiral', position: { x: 0, y: 0 }, scale: 0.1 },
      { pattern: 'zigzag', position: { x: Number.NaN, y: 0 }, scale: 0.1 },
      { pattern: 'floral', position: { x: 0, y: 0 }, scale: -1 },
    ]);
    expect(kept.map((o) => o.pattern)).toEqual(['dots']);
    expect(sanitizeOrnaments(undefined)).toEqual([]);
  });
  it('draws ornaments at their segment-local position', () => {
    const s = ornamentStrokes({ pattern: 'dots', position: { x: 0.1, y: -0.2 }, scale: 0.05 });
    expect(s.dots[0]!.center).toEqual({ x: 0.1, y: -0.2 });
  });
});

describe('segment views', () => {
  it('uses multiply blending and clamped opacity', () => {
    const seg = ARJUN.rig.segments[0]!;
    const v = buildSegmentView(seg, 0, { segmentId: seg.id, color: '#336699', opacity: 2 }, ARJUN.appearance.palette);
    expect(v.mesh.blendMode).toBe('multiply');
    expect(v.mesh.alpha).toBe(ALPHA_MAX);
    expect(v.mesh.tint).toBe(0x336699);
  });
  it('renders a solid segment when perforation data is bad', () => {
    const seg = ARJUN.rig.segments[0]!;
    const v = buildSegmentView(seg, 0, { segmentId: seg.id, color: '#336699', opacity: 0.5, perforations: [[{ x: 9, y: 9 }]] }, []);
    expect(v.geometry.fallbackReason).toBe('invalid-perforation');
    expect(v.geometry.indices.length).toBeGreaterThan(0);
  });
});

describe('effect visuals', () => {
  it('renders clones as faded copies of the owner color', () => {
    const v = effectVisual('clone', { type: 'cuboid', ...CLONE_HALF_EXTENTS }, '#3f7a5a');
    expect(v.color).toBe(0x3f7a5a);
    expect(v.alpha).toBe(CLONE_ALPHA);
    expect(v.parts.length).toBeGreaterThan(1);
  });
  it('gives arrows a shaft and head and wheels spoke holes', () => {
    expect(effectVisual('arrow', { type: 'cuboid', hx: 0.2, hy: 0.015 }).parts.length).toBe(4);
    expect(effectVisual('chariot_wheel', { type: 'ball', radius: 0.35 }).parts[0]!.holes.length).toBe(6);
  });
});

describe('PuppetRenderer', () => {
  beforeAll(async () => {
    await SimWorld.init();
  });

  it('maps segment transforms to Stage pixels and places rivets at joints', () => {
    const world = SimWorld.create(KURUKSHETRA_STAGE, ARJUN_VS_DURYODHAN.characters, 3);
    const { view } = buildStageScene(KURUKSHETRA_STAGE, 3);
    const r = new PuppetRenderer(view, ARJUN_VS_DURYODHAN);
    for (let i = 0; i < 10; i++) world.step();
    r.sync(world);
    for (const c of ARJUN_VS_DURYODHAN.characters) {
      const puppet = r.puppet(c.id)!;
      expect(puppet.container.visible).toBe(true);
      const facing = world.ragdoll(c.id).facing;
      for (const s of c.rig.segments) {
        const t = world.segmentTransform(c.id, s.id);
        const sv = puppet.segments.get(s.id)!;
        const p = worldToStagePx(view.layout, t);
        expect(sv.root.position.x).toBeCloseTo(p.x, 3);
        expect(sv.root.position.y).toBeCloseTo(p.y, 3);
        expect(sv.root.rotation).toBeCloseTo(-t.angle, 6);
        expect(sv.art.scale.x).toBe(facing);
      }
      const rivets = r.pivotLayer().rivetsOf(c.id);
      expect(rivets).toHaveLength(c.rig.joints.length);
      // Compare against the anchor Rapier actually uses for each joint.
      world.ragdoll(c.id).joints.forEach((j, i) => {
        const joint = world.world.getImpulseJoint(j.handle);
        const b = joint.body1();
        const a = joint.anchor1();
        const ang = b.rotation();
        const wx = b.translation().x + a.x * Math.cos(ang) - a.y * Math.sin(ang);
        const wy = b.translation().y + a.x * Math.sin(ang) + a.y * Math.cos(ang);
        const p = worldToStagePx(view.layout, { x: wx, y: wy });
        expect(rivets[i]!.visible).toBe(true);
        expect(rivets[i]!.position.x).toBeCloseTo(p.x, 2);
        expect(rivets[i]!.position.y).toBeCloseTo(p.y, 2);
      });
    }
    r.destroy();
    view.destroy();
    world.free();
  });

  it('culls rivets outside the visible Stage', () => {
    const layout = createStageLayout(KURUKSHETRA_STAGE);
    const [a] = jointAnchors(ARJUN.rig, 1);
    expect(placePivot(layout, { x: 50, y: 1, angle: 0 }, a!).visible).toBe(false);
    expect(placePivot(layout, { x: 0, y: 1, angle: 0 }, a!).visible).toBe(true);
  });

  it('pools effect graphics and releases effects removed from the sim', () => {
    const world = SimWorld.create(KURUKSHETRA_STAGE, ARJUN_VS_DURYODHAN.characters, 5);
    const target = { layout: createStageLayout(KURUKSHETRA_STAGE), layers: { puppets: new Container(), effects: new Container(), pivots: new Container() } };
    const r = new PuppetRenderer(target, ARJUN_VS_DURYODHAN);
    const arrow = world.spawnEffect({ kind: 'arrow', shape: { type: 'cuboid', hx: 0.2, hy: 0.015 }, position: { x: 0, y: 4 }, gravityScale: 0 });
    world.spawnEffect({ kind: 'clone', shape: { type: 'cuboid', ...CLONE_HALF_EXTENTS }, position: { x: 1, y: 4 }, gravityScale: 0, ownerCharacterId: 'arjun' });
    world.spawnEffect({ kind: 'boulder', shape: { type: 'ball', radius: 0.25 }, position: { x: -1, y: 4 }, gravityScale: 0 });
    r.sync(world);
    expect(r.effectStats()).toEqual({ active: 3, free: 0, created: 3 });
    const effectGraphics = target.layers.effects.children;
    const visible = effectGraphics.filter((g) => g.visible);
    expect(visible).toHaveLength(3);
    for (const g of visible) expect(g.blendMode).toBe('multiply');
    const p = worldToStagePx(target.layout, { x: 0, y: 4 });
    expect(visible.some((g) => Math.abs(g.position.x - p.x) < 1e-3 && Math.abs(g.position.y - p.y) < 1e-3)).toBe(true);

    world.despawnEffect(arrow.id);
    r.sync(world);
    expect(r.effectStats()).toEqual({ active: 2, free: 1, created: 3 });
    expect(effectGraphics.filter((g) => g.visible)).toHaveLength(2);

    world.spawnEffect({ kind: 'arrow', shape: { type: 'cuboid', hx: 0.2, hy: 0.015 }, position: { x: 0, y: 5 }, gravityScale: 0 });
    r.sync(world);
    expect(r.effectStats()).toEqual({ active: 3, free: 0, created: 3 });
    r.destroy();
    world.free();
  });

  it('uses the torso color for clones', () => {
    const torsoColor = ARJUN.appearance.segments.find((a) => a.segmentId === 'torso')!.color;
    expect(cloneColorOf(ARJUN)).toBe(torsoColor);
    const bare: PuppetCharacter = { ...ARJUN, appearance: { palette: ['#111111', '#222222'], segments: [] } };
    expect(cloneColorOf(bare)).toBe('#222222');
  });
});
