// Pivot rivets drawn on the top layer at every joint's on-screen position each frame (Req 1.2).
import { Container, Graphics } from 'pixi.js';
import type { RigSpec, Vec2 } from '../core/scenario/types';
import type { BodyTransform, Facing } from '../sim/world';
import { bodyPointToWorld, isInsideStage, worldToStagePx, type StageLayout } from './layout';

export const RIVET_RADIUS_PX = 4.5;
const RIVET_RIM = 0x2a1a10;
const RIVET_HEAD = 0xe8c07a;

export interface JointAnchor {
  parent: string;
  child: string;
  /** Joint anchor in the parent body's frame, meters, y-up, already mirrored for facing. */
  local: Vec2;
}

/** Parent-frame anchors, matching how the sim builds revolute joints from the rest pose. */
export function jointAnchors(rig: RigSpec, facing: Facing): JointAnchor[] {
  const rest = new Map(rig.segments.map((s) => [s.id, s.restPosition]));
  const out: JointAnchor[] = [];
  for (const j of rig.joints) {
    const p = rest.get(j.parent);
    if (!p) continue;
    out.push({ parent: j.parent, child: j.child, local: { x: (j.anchor.x - p.x) * facing, y: j.anchor.y - p.y } });
  }
  return out;
}

export interface PivotPlacement {
  x: number;
  y: number;
  visible: boolean;
}

/** Stage-pixel position of a joint and whether it lies inside the visible Stage. */
export function placePivot(layout: StageLayout, parent: BodyTransform, anchor: JointAnchor): PivotPlacement {
  const p = worldToStagePx(layout, bodyPointToWorld(parent, anchor.local));
  return { x: p.x, y: p.y, visible: isInsideStage(layout, p) };
}

function rivet(): Graphics {
  const g = new Graphics();
  g.circle(0, 0, RIVET_RADIUS_PX).fill({ color: RIVET_RIM, alpha: 0.95 });
  g.circle(0, 0, RIVET_RADIUS_PX * 0.5).fill({ color: RIVET_HEAD, alpha: 1 });
  return g;
}

interface CharacterPivots {
  facing: Facing;
  anchors: JointAnchor[];
  rivets: Graphics[];
}

export class PivotLayer {
  private readonly byCharacter = new Map<string, CharacterPivots>();

  constructor(
    private readonly layer: Container,
    private readonly layout: StageLayout,
  ) {}

  /** Positions the rivets of one character from its segment transforms (keyed by segment id). */
  update(characterId: string, rig: RigSpec, facing: Facing, segments: ReadonlyMap<string, BodyTransform>): void {
    let entry = this.byCharacter.get(characterId);
    if (!entry || entry.facing !== facing) {
      const anchors = jointAnchors(rig, facing);
      const rivets = entry?.rivets ?? [];
      while (rivets.length < anchors.length) {
        const g = rivet();
        g.label = `pivot:${characterId}:${rivets.length}`;
        this.layer.addChild(g);
        rivets.push(g);
      }
      entry = { facing, anchors, rivets };
      this.byCharacter.set(characterId, entry);
    }
    entry.anchors.forEach((a, i) => {
      const g = entry.rivets[i]!;
      const parent = segments.get(a.parent);
      if (!parent) {
        g.visible = false;
        return;
      }
      const p = placePivot(this.layout, parent, a);
      g.position.set(p.x, p.y);
      g.visible = p.visible;
    });
  }

  /** Rivets for a character, in joint order (for tests and debugging). */
  rivetsOf(characterId: string): readonly Graphics[] {
    return this.byCharacter.get(characterId)?.rivets ?? [];
  }

  destroy(): void {
    for (const e of this.byCharacter.values()) for (const g of e.rivets) g.destroy();
    this.byCharacter.clear();
  }
}
