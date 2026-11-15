// projectile_volley: `count` projectiles launched from the actor's front hand toward the target,
// one every `intervalMs`, each aimed on a ballistic arc at the target's torso and perturbed by a
// seeded random angle within `spreadDeg`.
import { PROJECTILE_VOLLEY } from '../../core/moveblock/primitiveSchemas';
import type { EffectShape } from '../world';
import { aimPoint, ballisticAngle, deg2rad, G, msToSteps, pickSegment, readParams } from './shared';
import type { MovePrimitiveImpl } from './types';

type ProjectileShape = 'arrow' | 'spear' | 'disc' | 'stone' | 'fireball';

interface ProjectileSpec {
  shape: EffectShape;
  /** Target mass in kg. Kept small so even 60 m/s impacts stay near 1-2 N·s per hit. */
  mass: number;
  gravityScale: number;
  /** Spin in rad/s, signed by travel direction. */
  spin: number;
}

const PROJECTILES: Record<ProjectileShape, ProjectileSpec> = {
  arrow: { shape: { type: 'cuboid', hx: 0.2, hy: 0.015 }, mass: 0.02, gravityScale: 1, spin: 0 },
  spear: { shape: { type: 'cuboid', hx: 0.35, hy: 0.02 }, mass: 0.035, gravityScale: 1, spin: 0 },
  disc: { shape: { type: 'ball', radius: 0.08 }, mass: 0.025, gravityScale: 1, spin: 20 },
  stone: { shape: { type: 'ball', radius: 0.06 }, mass: 0.03, gravityScale: 1, spin: 0 },
  fireball: { shape: { type: 'ball', radius: 0.1 }, mass: 0.02, gravityScale: 0.2, spin: 0 },
};

const area = (s: EffectShape): number =>
  s.type === 'ball' ? Math.PI * s.radius * s.radius : s.type === 'cuboid' ? 4 * s.hx * s.hy : 0.01;

/** Distance ahead of the hand (along the aim) where projectiles appear, clear of the actor's body. */
export const MUZZLE_OFFSET_M = 0.5;
/** Spacing between projectiles released in the same step, perpendicular to the aim. */
const SAME_STEP_SPACING_M = 0.06;
/** Projectiles are removed after this long so missed shots settle (design: validator settle rule). */
export const PROJECTILE_LIFETIME_STEPS = 180;

export const projectileVolley: MovePrimitiveImpl = {
  name: PROJECTILE_VOLLEY.name,
  descriptor: PROJECTILE_VOLLEY,
  apply(ctx, raw) {
    const p = readParams(PROJECTILE_VOLLEY, raw);
    const count = p.count as number;
    const shape = p.projectileShape as ProjectileShape;
    const speed = p.speed as number;
    const spreadDeg = p.spreadDeg as number;
    const intervalMs = p.intervalMs as number;
    const spec = PROJECTILES[shape];
    const g = G * spec.gravityScale;

    // Randomness is drawn up front in spawn order so it does not depend on step interleaving.
    const jitters = Array.from({ length: count }, () => (spreadDeg > 0 ? ctx.rng.range(-spreadDeg / 2, spreadDeg / 2) : 0));
    const offsets = jitters.map((_, i) => msToSteps(i * intervalMs));

    jitters.forEach((jitterDeg, i) => {
      const offset = offsets[i]!;
      const sameStepRank = offsets.slice(0, i).filter((o) => o === offset).length;
      ctx.at(offset, () => {
        const { world, actorId, targetId } = ctx;
        const target = aimPoint(world, actorId, targetId);
        const handId = pickSegment(world, actorId, 'hand', target);
        const hand = world.segmentTransform(actorId, handId);
        const dir = Math.sign(target.x - hand.x) || world.ragdoll(actorId).facing;
        // Aim from the muzzle point, assumed level with the hand, then launch from there.
        const muzzleX = hand.x + dir * MUZZLE_OFFSET_M;
        const dx = Math.max(Math.abs(target.x - muzzleX), 0.05);
        const base = ballisticAngle(dx, target.y - hand.y, speed, g) ?? Math.PI / 4;
        const angle = base + deg2rad(jitterDeg);
        const vx = Math.cos(angle) * speed * dir;
        const vy = Math.sin(angle) * speed;
        // Stack same-step projectiles perpendicular to the aim (upward side) so they do not overlap.
        const lateral = sameStepRank * SAME_STEP_SPACING_M;
        const pos = {
          x: muzzleX + (-vy / speed) * lateral * dir,
          y: hand.y + (vx / speed) * lateral * dir,
        };
        ctx.spawn({
          kind: shape,
          shape: spec.shape,
          position: pos,
          angle: Math.atan2(vy, vx),
          linvel: { x: vx, y: vy },
          angvel: -spec.spin * dir,
          density: spec.mass / area(spec.shape),
          gravityScale: spec.gravityScale,
          restitution: 0.05,
          ccd: true,
          lifetimeSteps: PROJECTILE_LIFETIME_STEPS,
        });
      });
    });
  },
};
