// Line patterns for segment ornaments, centred on the ornament's segment-local position (Req 1.4).
// Pure: returns polylines and dots in segment-local meters (y-up).
import type { Ornament, Vec2 } from '../core/scenario/types';

export interface OrnamentStrokes {
  /** Open or closed polylines (closed ones repeat their first point). */
  lines: Vec2[][];
  dots: { center: Vec2; radius: number }[];
}

function ring(cx: number, cy: number, rx: number, ry: number, rot: number, n: number): Vec2[] {
  const out: Vec2[] = [];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    out.push({ x: cx + x * c - y * s, y: cy + x * s + y * c });
  }
  return out;
}

/** Axis-aligned bounds of all strokes and dots. Every pattern is centred on its ornament position. */
export function strokesBounds(s: OrnamentStrokes): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of s.lines) {
    for (const p of line) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  for (const d of s.dots) {
    minX = Math.min(minX, d.center.x - d.radius); maxX = Math.max(maxX, d.center.x + d.radius);
    minY = Math.min(minY, d.center.y - d.radius); maxY = Math.max(maxY, d.center.y + d.radius);
  }
  return { minX, minY, maxX, maxY };
}

export function ornamentStrokes(o: Ornament): OrnamentStrokes {
  const { x: cx, y: cy } = o.position;
  const k = o.scale;
  switch (o.pattern) {
    case 'dots': {
      const r = k * 0.18;
      const dots = [{ center: { x: cx, y: cy }, radius: r }];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        dots.push({ center: { x: cx + Math.cos(a) * k * 0.6, y: cy + Math.sin(a) * k * 0.6 }, radius: r });
      }
      return { lines: [], dots };
    }
    case 'zigzag': {
      const line: Vec2[] = [];
      const n = 6;
      for (let i = 0; i <= n; i++) {
        line.push({ x: cx - k + (2 * k * i) / n, y: cy + (i % 2 === 0 ? -0.4 : 0.4) * k });
      }
      return { lines: [line], dots: [] };
    }
    case 'floral': {
      const lines: Vec2[][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        lines.push(ring(cx + Math.cos(a) * k * 0.5, cy + Math.sin(a) * k * 0.5, k * 0.45, k * 0.18, a, 12));
      }
      return { lines, dots: [{ center: { x: cx, y: cy }, radius: k * 0.15 }] };
    }
    case 'scale': {
      // Three rows of downward fish-scale arcs; rows are lifted by r/2 so the pattern's bounding box
      // is centred on the ornament position.
      const lines: Vec2[][] = [];
      const r = k * 0.35;
      for (let row = 0; row < 3; row++) {
        const y = cy + (1 - row) * r * 1.1 + r * 0.5;
        for (let col = -1; col <= 1; col++) {
          const x = cx + col * 2 * r;
          const arc: Vec2[] = [];
          for (let i = 0; i <= 8; i++) {
            const t = Math.PI + (i / 8) * Math.PI;
            arc.push({ x: x + Math.cos(t) * r, y: y + Math.sin(t) * r });
          }
          lines.push(arc);
        }
      }
      return { lines, dots: [] };
    }
  }
}
