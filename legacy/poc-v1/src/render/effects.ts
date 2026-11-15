// Pooled translucent multiply graphics for Move effects: projectiles, clones, summoned objects (Req 1.6, 1.7).
import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import { Container, Graphics } from 'pixi.js';
import type { Vec2 } from '../core/scenario/types';
import type { BodyTransform, EffectInfo, EffectKind, EffectShape } from '../sim/world';
import { effectShapeKey, effectVisual } from './effectShapes';
import { worldAngleToScreen, worldToStagePx, type StageLayout } from './layout';
import { PUPPET_BLEND_MODE } from './style';

/** Minimal collider view used to read an effect's shape. Rapier's `Collider` satisfies it. */
export interface ShapeSource {
  shapeType(): number;
  radius(): number;
  halfExtents(): { x: number; y: number } | null;
  vertices(): Float32Array;
}

/** Reads an effect shape back from its Rapier collider. Returns null for unsupported shapes. */
export function shapeFromCollider(c: ShapeSource): EffectShape | null {
  switch (c.shapeType()) {
    case RAPIER.ShapeType.Ball:
      return { type: 'ball', radius: c.radius() };
    case RAPIER.ShapeType.Cuboid: {
      const he = c.halfExtents();
      return he ? { type: 'cuboid', hx: he.x, hy: he.y } : null;
    }
    case RAPIER.ShapeType.ConvexPolygon: {
      const v = c.vertices();
      const points: Vec2[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) points.push({ x: v[i]!, y: v[i + 1]! });
      return points.length >= 3 ? { type: 'polygon', points } : null;
    }
    default:
      return null;
  }
}

function drawVisual(g: Graphics, kind: EffectKind, shape: EffectShape, ownerColor: string | undefined, ppm: number): void {
  const visual = effectVisual(kind, shape, ownerColor);
  const flat = (pts: Vec2[]) => pts.flatMap((p) => [p.x * ppm, -p.y * ppm]);
  g.clear();
  for (const part of visual.parts) {
    g.poly(flat(part.outline)).fill({ color: visual.color, alpha: visual.alpha });
    for (const h of part.holes) g.poly(flat(h)).cut();
  }
  g.blendMode = PUPPET_BLEND_MODE;
}

interface ActiveEffect {
  g: Graphics;
  key: string;
}

export interface EffectFrame {
  transforms: readonly ({ id: number; kind: EffectKind } & BodyTransform)[];
  /** Effect metadata by id, used only when an effect first appears. */
  info: (id: number) => EffectInfo | undefined;
  shape: (info: EffectInfo) => EffectShape | null;
  ownerColor: (characterId: string | null) => string | undefined;
}

export class EffectLayer {
  private readonly active = new Map<number, ActiveEffect>();
  /** Released graphics by appearance key, reused without redrawing when the key matches. */
  private readonly free = new Map<string, Graphics[]>();
  private freeCount = 0;
  private created = 0;

  constructor(
    private readonly layer: Container,
    private readonly layout: StageLayout,
  ) {}

  private acquire(key: string, draw: (g: Graphics) => void): Graphics {
    const same = this.free.get(key);
    let g = same?.pop();
    if (g) {
      this.freeCount--;
    } else {
      // Take any free graphics and redraw it, or grow the pool.
      for (const [k, list] of this.free) {
        g = list.pop();
        if (list.length === 0) this.free.delete(k);
        if (g) {
          this.freeCount--;
          break;
        }
      }
      if (!g) {
        g = new Graphics();
        this.created++;
        this.layer.addChild(g);
      }
      draw(g);
    }
    if (same && same.length === 0) this.free.delete(key);
    g.visible = true;
    return g;
  }

  private release(e: ActiveEffect): void {
    e.g.visible = false;
    const list = this.free.get(e.key) ?? [];
    list.push(e.g);
    this.free.set(e.key, list);
    this.freeCount++;
  }

  sync(frame: EffectFrame): void {
    const seen = new Set<number>();
    for (const t of frame.transforms) {
      seen.add(t.id);
      let a = this.active.get(t.id);
      if (!a) {
        const info = frame.info(t.id);
        const shape = info ? frame.shape(info) : null;
        if (!info || !shape) continue;
        const owner = frame.ownerColor(info.ownerCharacterId);
        const key = effectShapeKey(t.kind, shape, owner);
        const g = this.acquire(key, (gr) => drawVisual(gr, t.kind, shape, owner, this.layout.ppm));
        a = { g, key };
        this.active.set(t.id, a);
      }
      const p = worldToStagePx(this.layout, t);
      a.g.position.set(p.x, p.y);
      a.g.rotation = worldAngleToScreen(t.angle);
    }
    // Effects removed from the sim go back to the pool.
    for (const [id, a] of this.active) {
      if (!seen.has(id)) {
        this.release(a);
        this.active.delete(id);
      }
    }
  }

  stats(): { active: number; free: number; created: number } {
    return { active: this.active.size, free: this.freeCount, created: this.created };
  }

  destroy(): void {
    for (const a of this.active.values()) a.g.destroy();
    for (const list of this.free.values()) for (const g of list) g.destroy();
    this.active.clear();
    this.free.clear();
    this.freeCount = 0;
  }
}
