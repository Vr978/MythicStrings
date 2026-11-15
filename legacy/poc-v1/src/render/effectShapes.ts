// Pure visual description of Move effects (projectiles, clones, summoned objects) as flat translucent
// polygons in body-local meters, y-up (Req 1.6). No PixiJS imports.
import type { Vec2 } from '../core/scenario/types';
import type { EffectShape } from '../sim/world';
import { clampAlpha, parseHexColor } from './style';

export interface EffectPart {
  outline: Vec2[];
  holes: Vec2[][];
}

export interface EffectVisual {
  color: number;
  /** Always within [0.3, 0.9]. */
  alpha: number;
  parts: EffectPart[];
}

/** Clones are drawn as faded copies of the acting character's color. */
export const CLONE_ALPHA = 0.35;
const DEFAULT_EFFECT_ALPHA = 0.75;

const KIND_COLORS: Record<string, string> = {
  arrow: '#3b2414',
  spear: '#4a3020',
  disc: '#8a7a5a',
  stone: '#6a6a6a',
  fireball: '#d8641e',
  boulder: '#6b5a4a',
  mace: '#7a5a2a',
  wall: '#5a4632',
  chariot_wheel: '#5a3a1a',
  serpent: '#2f5a3a',
};
const KIND_ALPHAS: Record<string, number> = { fireball: 0.6, clone: CLONE_ALPHA };
const DEFAULT_COLOR = 0x4a3a2a;

function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function circle(cx: number, cy: number, r: number, n: number, jitter?: (i: number) => number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (jitter ? jitter(i) : 1);
    out.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return out;
}

function solid(outline: Vec2[]): EffectPart {
  return { outline, holes: [] };
}

function projectile(hx: number, hy: number): EffectPart[] {
  const shaftHalf = Math.max(hy * 0.45, 0.006);
  const headStart = hx * 0.7;
  const headHalf = Math.max(hy * 1.6, 0.02);
  const shaft = rect(-hx, -shaftHalf, headStart, shaftHalf);
  const head: Vec2[] = [
    { x: headStart, y: -headHalf },
    { x: hx, y: 0 },
    { x: headStart, y: headHalf },
  ];
  const fl = hx * 0.2;
  const fletchTop: Vec2[] = [
    { x: -hx, y: shaftHalf },
    { x: -hx + fl, y: shaftHalf },
    { x: -hx - fl * 0.3, y: headHalf },
  ];
  const fletchBottom: Vec2[] = fletchTop.map((p) => ({ x: p.x, y: -p.y }));
  return [solid(shaft), solid(head), solid(fletchTop), solid(fletchBottom)];
}

/** Small puppet silhouette filling a hx × hy box. */
function cloneSilhouette(hx: number, hy: number): EffectPart[] {
  const headR = Math.min(hx * 0.45, hy * 0.2);
  const neck = hy - headR * 2;
  const torso: Vec2[] = [
    { x: -hx * 0.55, y: neck },
    { x: hx * 0.55, y: neck },
    { x: hx * 0.4, y: -hy * 0.15 },
    { x: -hx * 0.4, y: -hy * 0.15 },
  ];
  const legL = rect(-hx * 0.4, -hy, -hx * 0.08, -hy * 0.15);
  const legR = rect(hx * 0.08, -hy, hx * 0.4, -hy * 0.15);
  const armL = rect(-hx, neck - hy * 0.55, -hx * 0.6, neck);
  const armR = rect(hx * 0.6, neck - hy * 0.55, hx, neck);
  return [solid(circle(0, hy - headR, headR, 12)), solid(torso), solid(legL), solid(legR), solid(armL), solid(armR)];
}

function ballParts(kind: string, r: number): EffectPart[] {
  switch (kind) {
    case 'boulder':
    case 'stone': {
      const j = [1, 0.86, 0.97, 0.9, 1.04, 0.88, 0.99, 0.92, 1.02];
      return [solid(circle(0, 0, r, 9, (i) => j[i % j.length]!))];
    }
    case 'mace': {
      // Spiked head: a star polygon.
      const pts: Vec2[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rr = i % 2 === 0 ? r : r * 0.78;
        pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
      }
      return [solid(pts)];
    }
    case 'chariot_wheel': {
      // Rim and spokes, with the gaps between spokes cut out as holes.
      const spokes = 6;
      const holes: Vec2[][] = [];
      const inner = r * 0.8;
      const hub = r * 0.2;
      for (let s = 0; s < spokes; s++) {
        const a0 = (s / spokes) * Math.PI * 2 + 0.16;
        const a1 = ((s + 1) / spokes) * Math.PI * 2 - 0.16;
        const hole: Vec2[] = [];
        for (let i = 0; i <= 4; i++) {
          const a = a0 + ((a1 - a0) * i) / 4;
          hole.push({ x: Math.cos(a) * inner, y: Math.sin(a) * inner });
        }
        const mid = (a0 + a1) / 2;
        hole.push({ x: Math.cos(mid) * hub * 1.6, y: Math.sin(mid) * hub * 1.6 });
        holes.push(hole);
      }
      return [{ outline: circle(0, 0, r, 24), holes }];
    }
    case 'disc':
      return [{ outline: circle(0, 0, r, 16), holes: [circle(0, 0, r * 0.4, 12)] }];
    default:
      return [solid(circle(0, 0, r, 16))];
  }
}

/**
 * Describes how an effect body looks. `ownerColor` (hex string) is used for clones so they read as
 * faded copies of the character that cast them.
 */
export function effectVisual(kind: string, shape: EffectShape, ownerColor?: string): EffectVisual {
  const isClone = kind === 'clone';
  const fallback = KIND_COLORS[kind] !== undefined ? parseHexColor(KIND_COLORS[kind], DEFAULT_COLOR) : DEFAULT_COLOR;
  const color = isClone ? parseHexColor(ownerColor, fallback) : fallback;
  const alpha = clampAlpha(KIND_ALPHAS[kind] ?? DEFAULT_EFFECT_ALPHA);
  let parts: EffectPart[];
  switch (shape.type) {
    case 'ball':
      parts = ballParts(kind, shape.radius);
      break;
    case 'cuboid':
      if (isClone) parts = cloneSilhouette(shape.hx, shape.hy);
      else if (kind === 'arrow' || kind === 'spear') parts = projectile(shape.hx, shape.hy);
      else parts = [solid(rect(-shape.hx, -shape.hy, shape.hx, shape.hy))];
      break;
    case 'polygon':
      parts = [solid(shape.points.map((p) => ({ x: p.x, y: p.y })))];
      break;
  }
  return { color, alpha, parts };
}

/** Stable cache key for pooling by appearance. */
export function effectShapeKey(kind: string, shape: EffectShape, ownerColor?: string): string {
  const owner = kind === 'clone' ? `:${ownerColor ?? ''}` : '';
  switch (shape.type) {
    case 'ball':
      return `${kind}:b:${shape.radius.toFixed(4)}${owner}`;
    case 'cuboid':
      return `${kind}:c:${shape.hx.toFixed(4)}x${shape.hy.toFixed(4)}${owner}`;
    case 'polygon':
      return `${kind}:p:${shape.points.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(';')}${owner}`;
  }
}
