// Segment triangulation with perforation holes (Req 1.4) and the plain-outline fallback (Req 1.5).
// Pure: no PixiJS imports. Coordinates stay in segment-local meters (y-up).
import earcut from 'earcut';
import type { Ornament, SegmentArt, SegmentSpec, Vec2 } from '../core/scenario/types';

export type GeometryFallbackReason =
  | 'invalid-perforation'
  | 'self-intersecting-hole'
  | 'hole-outside-outline'
  | 'overlapping-holes'
  | 'triangulation-failed';

export interface SegmentGeometry {
  /** Flattened [x0, y0, x1, y1, ...]: the outline ring followed by each hole ring. */
  positions: number[];
  /** Triangle vertex indices into `positions` (pairs). */
  indices: number[];
  outline: Vec2[];
  /** Hole rings actually cut into the segment. Empty when falling back. */
  holes: Vec2[][];
  /** Why the perforations were dropped, or null if they were used (or there were none). */
  fallbackReason: GeometryFallbackReason | null;
}

const EPS = 1e-12;

export function signedArea(ring: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j]!.x - ring[i]!.x) * (ring[j]!.y + ring[i]!.y);
  }
  return a / 2;
}

function isFinitePoint(p: unknown): p is Vec2 {
  return (
    typeof p === 'object' &&
    p !== null &&
    Number.isFinite((p as Vec2).x) &&
    Number.isFinite((p as Vec2).y)
  );
}

/** At least 3 finite points with non-zero area. */
export function isValidRing(ring: unknown): ring is Vec2[] {
  return Array.isArray(ring) && ring.length >= 3 && ring.every(isFinitePoint) && Math.abs(signedArea(ring)) > EPS;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(v) < EPS ? 0 : Math.sign(v);
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a.x, b.x) - EPS <= p.x &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    Math.min(a.y, b.y) - EPS <= p.y &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}

/** True when closed segments ab and cd share any point (touching counts). */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

/** A ring is simple when no two non-adjacent edges touch and no adjacent edges overlap. */
export function isSimpleRing(ring: readonly Vec2[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      const c = ring[j]!;
      const d = ring[(j + 1) % n]!;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Adjacent edges share one vertex; they must not fold back over each other.
        const shared = j === i + 1 ? b : a;
        const other1 = j === i + 1 ? a : b;
        const other2 = j === i + 1 ? d : c;
        if (orient(other1, shared, other2) === 0) {
          const dot = (other1.x - shared.x) * (other2.x - shared.x) + (other1.y - shared.y) * (other2.y - shared.y);
          if (dot > 0) return false;
        }
        continue;
      }
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

/** Even-odd point-in-polygon test. Points on the boundary may go either way. */
export function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function ringsTouch(r1: readonly Vec2[], r2: readonly Vec2[]): boolean {
  for (let i = 0; i < r1.length; i++) {
    const a = r1[i]!;
    const b = r1[(i + 1) % r1.length]!;
    for (let j = 0; j < r2.length; j++) {
      if (segmentsIntersect(a, b, r2[j]!, r2[(j + 1) % r2.length]!)) return true;
    }
  }
  return false;
}

function triangulate(outline: Vec2[], holes: Vec2[][]): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const holeIndices: number[] = [];
  for (const p of outline) positions.push(p.x, p.y);
  for (const h of holes) {
    holeIndices.push(positions.length / 2);
    for (const p of h) positions.push(p.x, p.y);
  }
  const indices = earcut(positions, holeIndices.length ? holeIndices : null, 2);
  return { positions, indices };
}

function triangleAreaSum(positions: number[], indices: number[]): number {
  let sum = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i = indices[t]! * 2;
    const j = indices[t + 1]! * 2;
    const k = indices[t + 2]! * 2;
    sum += Math.abs(
      (positions[j]! - positions[i]!) * (positions[k + 1]! - positions[i + 1]!) -
        (positions[k]! - positions[i]!) * (positions[j + 1]! - positions[i + 1]!),
    ) / 2;
  }
  return sum;
}

function areaMatches(expected: number, actual: number): boolean {
  return Math.abs(expected - actual) <= Math.max(1e-9, Math.abs(expected) * 1e-6);
}

/** Validates perforation rings against the outline. Returns a reason when unusable. */
export function validatePerforations(outline: Vec2[], perforations: unknown): GeometryFallbackReason | null {
  if (!Array.isArray(perforations)) return 'invalid-perforation';
  for (const h of perforations) {
    if (!Array.isArray(h) || h.length < 3 || !h.every(isFinitePoint)) return 'invalid-perforation';
    if (!isSimpleRing(h)) return 'self-intersecting-hole';
    if (!isValidRing(h)) return 'invalid-perforation';
    if (!h.every((p) => pointInRing(p, outline)) || ringsTouch(h, outline)) return 'hole-outside-outline';
  }
  for (let i = 0; i < perforations.length; i++) {
    for (let j = i + 1; j < perforations.length; j++) {
      const a = perforations[i] as Vec2[];
      const b = perforations[j] as Vec2[];
      if (ringsTouch(a, b) || pointInRing(a[0]!, b) || pointInRing(b[0]!, a)) return 'overlapping-holes';
    }
  }
  return null;
}

/**
 * Triangulates a segment's outline with its perforations as holes. When perforation data is absent
 * or unusable, returns the plain outline: the shape is unchanged, only the holes are dropped (Req 1.5).
 */
export function buildSegmentGeometry(
  segment: Pick<SegmentSpec, 'outline'>,
  art?: Pick<SegmentArt, 'perforations'> | null,
): SegmentGeometry {
  const outline = segment.outline.map((p) => ({ x: p.x, y: p.y }));
  const outlineArea = Math.abs(signedArea(outline));
  const plain = (fallbackReason: GeometryFallbackReason | null): SegmentGeometry => {
    const { positions, indices } = triangulate(outline, []);
    return { positions, indices, outline, holes: [], fallbackReason };
  };
  const perforations = art?.perforations;
  if (perforations === undefined || perforations === null) return plain(null);
  if (Array.isArray(perforations) && perforations.length === 0) return plain(null);
  if (!isValidRing(outline)) return plain('invalid-perforation');

  const reason = validatePerforations(outline, perforations);
  if (reason) return plain(reason);

  const holes = (perforations as Vec2[][]).map((h) => h.map((p) => ({ x: p.x, y: p.y })));
  let tri: { positions: number[]; indices: number[] };
  try {
    tri = triangulate(outline, holes);
  } catch {
    return plain('triangulation-failed');
  }
  const expected = outlineArea - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
  if (tri.indices.length === 0 || !areaMatches(expected, triangleAreaSum(tri.positions, tri.indices))) {
    return plain('triangulation-failed');
  }
  return { ...tri, outline, holes, fallbackReason: null };
}

export const ORNAMENT_PATTERNS = ['dots', 'zigzag', 'floral', 'scale'] as const;

/** Keeps only ornaments that can be drawn: known pattern, finite position, positive finite scale. */
export function sanitizeOrnaments(ornaments: unknown): Ornament[] {
  if (!Array.isArray(ornaments)) return [];
  return ornaments.filter(
    (o): o is Ornament =>
      typeof o === 'object' &&
      o !== null &&
      (ORNAMENT_PATTERNS as readonly string[]).includes((o as Ornament).pattern) &&
      isFinitePoint((o as Ornament).position) &&
      Number.isFinite((o as Ornament).scale) &&
      (o as Ornament).scale > 0,
  );
}

/** Area covered by a triangulation, exported for tests. */
export function geometryArea(g: Pick<SegmentGeometry, 'positions' | 'indices'>): number {
  return triangleAreaSum(g.positions, g.indices);
}
