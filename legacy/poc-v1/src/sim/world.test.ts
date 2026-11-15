import { beforeAll, describe, expect, it } from 'vitest';
import { PHYSICS_HZ } from '../core/config';
import { ARJUN, ARJUN_VS_DURYODHAN, DURYODHAN, KURUKSHETRA_STAGE } from '../content/scenarios/arjunVsDuryodhan';
import { SimWorld } from './world';

const deg = (d: number): number => (d * Math.PI) / 180;
const newWorld = (seed = 1): SimWorld => SimWorld.create(KURUKSHETRA_STAGE, ARJUN_VS_DURYODHAN.characters, seed);
const stepN = (w: SimWorld, n: number): void => {
  for (let i = 0; i < n; i++) w.step();
};
const footOnFloor = (w: SimWorld, id: string): boolean =>
  w.ragdoll(id).segments.some((s) => s.isFoot && w.segmentTransform(id, s.id).y < 0.35);

beforeAll(async () => {
  await SimWorld.init();
});

describe('SimWorld.create', () => {
  it('builds one body per segment in Scenario order, facing each other', () => {
    const w = newWorld();
    expect(w.characterIds()).toEqual(['arjun', 'duryodhan']);
    expect(w.bodyCount()).toBe(ARJUN.rig.segments.length + DURYODHAN.rig.segments.length);
    const a = w.segmentTransform('arjun', 'torso');
    const d = w.segmentTransform('duryodhan', 'torso');
    expect(a.x).toBeLessThan(d.x);
    expect(d.x - a.x).toBeGreaterThan(2);
    expect(w.ragdoll('arjun').facing).toBe(1);
    expect(w.ragdoll('duryodhan').facing).toBe(-1);
    w.free();
  });

  it('maps collider handles to their owners', () => {
    const w = newWorld();
    const seg = w.ragdoll('duryodhan').segments[2]!;
    expect(w.colliderOwner(seg.colliderHandle)).toEqual({ type: 'segment', characterId: 'duryodhan', segmentId: seg.id });
    w.free();
  });
});

describe('standing controller and joint limits', () => {
  it('holds the standing pose for 2 s with the torso within 15 degrees of vertical, even after a push', () => {
    const w = newWorld();
    for (let i = 0; i < 2 * PHYSICS_HZ; i++) {
      if (i === 10) w.applySegmentImpulse('arjun', 'torso', { x: 0.3, y: 0 });
      w.step();
      for (const id of w.characterIds()) expect(Math.abs(w.torsoAngle(id))).toBeLessThan(deg(15));
    }
    for (const id of w.characterIds()) expect(footOnFloor(w, id)).toBe(true);
    w.free();
  });

  it('keeps every joint within its limits (2 degree tolerance) under a large impulse', () => {
    const w = newWorld();
    w.applySegmentImpulse('arjun', 'head', { x: 0.9, y: 0.3 });
    w.applySegmentImpulse('duryodhan', 'forearm_l', { x: -0.6, y: -0.6 });
    w.releaseMotors('duryodhan');
    for (let i = 0; i < 3 * PHYSICS_HZ; i++) {
      w.step();
      for (const id of w.characterIds()) {
        for (const j of w.jointAngles(id)) {
          expect(j.angle).toBeGreaterThanOrEqual(j.lowerRad - deg(2));
          expect(j.angle).toBeLessThanOrEqual(j.upperRad + deg(2));
        }
      }
    }
    expect(w.allFinite()).toBe(true);
    w.free();
  });

  it('releaseMotors collapses the character and blocks re-enabling', () => {
    const w = newWorld();
    stepN(w, 30);
    const before = w.segmentTransform('duryodhan', 'head').y;
    w.releaseMotors('duryodhan');
    w.setStandingMotors('duryodhan', true);
    expect(w.isDefeated('duryodhan')).toBe(true);
    expect(w.motorsEnabled('duryodhan')).toBe(false);
    stepN(w, 3 * PHYSICS_HZ);
    expect(w.segmentTransform('duryodhan', 'head').y).toBeLessThan(before - 0.5);
    // The other character keeps standing.
    expect(Math.abs(w.torsoAngle('arjun'))).toBeLessThan(deg(15));
    w.free();
  });
});

describe('effects and contacts', () => {
  it('records hits from an effect body on the character it touches, ignoring floor and self contacts', () => {
    const w = newWorld();
    const torso = w.segmentTransform('duryodhan', 'torso');
    const e = w.spawnEffect({ kind: 'boulder', shape: { type: 'ball', radius: 0.2 }, position: { x: torso.x, y: 3 }, density: 5 });
    expect(w.effectCount('boulder')).toBe(1);
    expect(w.colliderOwner(e.colliderHandle)).toEqual({ type: 'effect', effectId: e.id, kind: 'boulder' });
    stepN(w, PHYSICS_HZ);
    const [arjun, dury] = w.hitTotals();
    expect(arjun).toEqual({ characterId: 'arjun', contactCount: 0, totalImpulse: 0 });
    expect(dury!.contactCount).toBeGreaterThan(0);
    expect(dury!.totalImpulse).toBeGreaterThan(0);
    expect(w.transforms().effects).toHaveLength(1);
    w.free();
  });

  it('removes effects when their lifetime ends', () => {
    const w = newWorld();
    w.spawnEffect({ kind: 'clone', shape: { type: 'cuboid', hx: 0.1, hy: 0.3 }, position: { x: 0, y: 1 }, lifetimeSteps: 5 });
    stepN(w, 4);
    expect(w.effectCount()).toBe(1);
    w.step();
    expect(w.effectCount()).toBe(0);
    w.free();
  });
});

describe('snapshots and determinism', () => {
  it('restored worlds step identically and keep metadata', () => {
    const w = newWorld(42);
    w.spawnEffect({ kind: 'arrow', shape: { type: 'cuboid', hx: 0.3, hy: 0.02 }, position: { x: -0.5, y: 1.3 }, linvel: { x: 15, y: 0 }, ccd: true });
    stepN(w, 20);
    w.releaseMotors('arjun');
    const r1 = w.rng.nextFloat();
    const snap = w.snapshot();
    const a = SimWorld.fromSnapshot(snap);
    const b = SimWorld.fromSnapshot(snap);
    expect(a.isDefeated('arjun')).toBe(true);
    expect(a.effectCount('arrow')).toBe(1);
    expect(a.steps).toBe(20);
    const ra = a.rng.nextFloat();
    expect(b.rng.nextFloat()).toBe(ra);
    expect(w.rng.nextFloat()).toBe(ra);
    expect(ra).not.toBe(r1);
    const reportsA = [];
    const reportsB = [];
    const reportsW = [];
    for (let i = 0; i < 90; i++) {
      reportsA.push(a.step());
      reportsB.push(b.step());
      reportsW.push(w.step());
    }
    expect(reportsB).toEqual(reportsA);
    expect(reportsW).toEqual(reportsA);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(w.snapshot()).toEqual(a.snapshot());
    expect(b.hitTotals()).toEqual(a.hitTotals());
    for (const x of [w, a, b]) x.free();
  });

  it('two worlds created from the same inputs produce identical snapshots', () => {
    const a = newWorld(7);
    const b = newWorld(7);
    stepN(a, 60);
    stepN(b, 60);
    expect(b.snapshot()).toEqual(a.snapshot());
    a.free();
    b.free();
  });
});
