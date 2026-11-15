// Drawing vocabulary for the leather-puppet look. A "Part" is one piece of dyed, translucent hide:
// its colour multiplies with the lit screen behind it (so overlapping pieces darken, as real leather
// does), it has a dark inked outline, and its punched holes show the screen's light through them.
import { Container, Graphics } from 'pixi.js';
import { hexToInt } from '../../shared/util';

export const INK = 0x1c0f08;
/** The colour of the lit screen as seen through a punched hole. */
export const HOLE = 0xfff0c8;
export const WOOD = 0x9a5a24;
export const STEEL = 0x8fa6c2;
export const BONE = 0xd9b56e;

export const col = (hex: string): number => hexToInt(hex);

/** Mixes two 24-bit colours. */
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t) << s;
  return ch(16) | ch(8) | ch(0);
}
export const darken = (c: number, t = 0.3): number => mix(c, 0x000000, t);
export const lighten = (c: number, t = 0.3): number => mix(c, 0xffffff, t);

export class Part {
  readonly c = new Container();
  /** Dyed leather: multiplies with what is behind it. */
  readonly g = new Graphics();
  /** Punched holes and bright details: drawn normally, on top. */
  readonly h = new Graphics();

  constructor(label?: string) {
    this.g.blendMode = 'multiply';
    this.c.addChild(this.g, this.h);
    if (label) this.c.label = label;
  }

  /** A filled, outlined polygon from a flat [x0, y0, x1, y1, ...] list. */
  poly(pts: number[], color: number, line = 2.2, alpha = 0.94): this {
    this.g.poly(pts).fill({ color, alpha });
    if (line > 0) this.g.poly(pts).stroke({ color: INK, width: line, alpha: 0.95, join: 'round' });
    return this;
  }

  circle(x: number, y: number, r: number, color: number, line = 2): this {
    this.g.circle(x, y, r).fill({ color, alpha: 0.94 });
    if (line > 0) this.g.circle(x, y, r).stroke({ color: INK, width: line, alpha: 0.95 });
    return this;
  }

  ellipse(x: number, y: number, rx: number, ry: number, color: number, line = 2): this {
    this.g.ellipse(x, y, rx, ry).fill({ color, alpha: 0.94 });
    if (line > 0) this.g.ellipse(x, y, rx, ry).stroke({ color: INK, width: line, alpha: 0.95 });
    return this;
  }

  /** An inked line through the given points, for folds, pleats and facial features. */
  line(pts: number[], width = 1.4, alpha = 0.85): this {
    this.g.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) this.g.lineTo(pts[i]!, pts[i + 1]!);
    this.g.stroke({ color: INK, width, alpha, cap: 'round', join: 'round' });
    return this;
  }

  /** One punched hole. */
  hole(x: number, y: number, r = 1.5): this {
    this.h.circle(x, y, r).fill({ color: HOLE, alpha: 0.95 });
    return this;
  }

  /** A row of punched holes from (x0,y0) to (x1,y1). */
  holes(x0: number, y0: number, x1: number, y1: number, n: number, r = 1.4): this {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.h.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r).fill({ color: HOLE, alpha: 0.95 });
    }
    return this;
  }

  /** A tapered limb from the joint at the origin down to (0, len), with rounded ends. */
  capsule(len: number, w0: number, w1: number, color: number): this {
    const pts: number[] = [];
    const r0 = w0 / 2;
    const r1 = w1 / 2;
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI + (Math.PI * i) / 6;
      pts.push(Math.cos(a) * r0, Math.sin(a) * r0);
    }
    for (let i = 0; i <= 6; i++) {
      const a = (Math.PI * i) / 6;
      pts.push(Math.cos(a) * r1, len + Math.sin(a) * r1);
    }
    return this.poly(pts, color);
  }

  /** A band across a limb at height y. */
  band(y: number, halfW: number, h: number, color: number): this {
    return this.poly([-halfW, y, halfW, y, halfW, y + h, -halfW, y + h], color, 1.6);
  }
}

/** Points along a quadratic curve, as a flat list. */
export function quad(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, n = 10): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
  }
  return out;
}

/** Outline of a ribbon of varying width along a centre line: used for tails, bows, horns and plumes. */
export function ribbon(centre: number[], width: (t: number) => number): number[] {
  const n = centre.length / 2;
  const left: number[] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = centre[i * 2]!;
    const y = centre[i * 2 + 1]!;
    const px = centre[Math.max(0, i - 1) * 2]!;
    const py = centre[Math.max(0, i - 1) * 2 + 1]!;
    const nx = centre[Math.min(n - 1, i + 1) * 2]!;
    const ny = centre[Math.min(n - 1, i + 1) * 2 + 1]!;
    const dx = nx - px;
    const dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    const w = width(n === 1 ? 0 : i / (n - 1)) / 2;
    left.push(x - (dy / len) * w, y + (dx / len) * w);
    right.push([x + (dy / len) * w, y - (dx / len) * w]);
  }
  // Walk back along the other side so the outline closes into one polygon.
  for (let i = right.length - 1; i >= 0; i--) left.push(right[i]![0], right[i]![1]);
  return left;
}

/** Points on an ellipse arc, as a flat list. */
export function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return out;
}
