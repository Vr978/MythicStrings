// PuppetRenderer: maps sim body transforms (meters, y-up) to Stage pixels every frame.
import type { Container } from 'pixi.js';
import type { PuppetCharacter, Scenario } from '../core/scenario/types';
import type { BodyTransform, EffectInfo, Facing, WorldTransforms } from '../sim/world';
import { EffectLayer, shapeFromCollider, type ShapeSource } from './effects';
import { worldAngleToScreen, worldToStagePx, type StageLayout } from './layout';
import { PivotLayer } from './pivots';
import { PuppetView } from './puppet';

/** The parts of `SimWorld` the renderer reads. `SimWorld` satisfies this structurally. */
export interface RenderableWorld {
  transforms(): WorldTransforms;
  effects(): readonly EffectInfo[];
  ragdoll(characterId: string): { facing: Facing };
  readonly world: { getCollider(handle: number): ShapeSource | null | undefined };
}

/** The parts of a `StageView` the renderer draws into. */
export interface StageTarget {
  readonly layout: StageLayout;
  readonly layers: { readonly puppets: Container; readonly effects: Container; readonly pivots: Container };
}

/** Color used for a character's clones: the torso art color, else the first palette garment color. */
export function cloneColorOf(character: PuppetCharacter): string | undefined {
  const torsoId = character.rig.segments.find((s) => s.role === 'torso')?.id;
  const torsoArt = character.appearance.segments.find((a) => a.segmentId === torsoId);
  return torsoArt?.color ?? character.appearance.palette[1] ?? character.appearance.palette[0];
}

export class PuppetRenderer {
  private readonly puppets = new Map<string, PuppetView>();
  private readonly characters = new Map<string, PuppetCharacter>();
  private readonly pivots: PivotLayer;
  private readonly effects: EffectLayer;
  private readonly segmentScratch = new Map<string, BodyTransform>();
  private destroyed = false;

  constructor(
    private readonly stage: StageTarget,
    scenario: Pick<Scenario, 'characters'>,
  ) {
    const ppm = stage.layout.ppm;
    for (const c of scenario.characters) {
      const view = new PuppetView(c, ppm);
      this.puppets.set(c.id, view);
      this.characters.set(c.id, c);
      stage.layers.puppets.addChild(view.container);
    }
    this.pivots = new PivotLayer(stage.layers.pivots, stage.layout);
    this.effects = new EffectLayer(stage.layers.effects, stage.layout);
  }

  /** Updates every segment, rivet, and effect from the current sim state. Call once per frame. */
  sync(world: RenderableWorld): void {
    if (this.destroyed) return;
    const layout = this.stage.layout;
    const t = world.transforms();
    for (const ch of t.characters) {
      const view = this.puppets.get(ch.id);
      const character = this.characters.get(ch.id);
      if (!view || !character) continue;
      const facing = world.ragdoll(ch.id).facing;
      view.setFacing(facing);
      view.container.visible = true;
      this.segmentScratch.clear();
      for (const s of ch.segments) {
        this.segmentScratch.set(s.id, s);
        const sv = view.segments.get(s.id);
        if (!sv) continue;
        const p = worldToStagePx(layout, s);
        sv.root.position.set(p.x, p.y);
        sv.root.rotation = worldAngleToScreen(s.angle);
      }
      this.pivots.update(ch.id, character.rig, facing, this.segmentScratch);
    }

    let infoById: Map<number, EffectInfo> | null = null;
    this.effects.sync({
      transforms: t.effects,
      info: (id) => {
        infoById ??= new Map(world.effects().map((e) => [e.id, e]));
        return infoById.get(id);
      },
      shape: (info) => {
        const c = world.world.getCollider(info.colliderHandle);
        return c ? shapeFromCollider(c) : null;
      },
      ownerColor: (id) => {
        const c = id === null ? undefined : this.characters.get(id);
        return c ? cloneColorOf(c) : undefined;
      },
    });
  }

  puppet(characterId: string): PuppetView | undefined {
    return this.puppets.get(characterId);
  }

  pivotLayer(): PivotLayer {
    return this.pivots;
  }

  effectStats(): { active: number; free: number; created: number } {
    return this.effects.stats();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.effects.destroy();
    this.pivots.destroy();
    for (const p of this.puppets.values()) p.destroy();
    this.puppets.clear();
  }
}
