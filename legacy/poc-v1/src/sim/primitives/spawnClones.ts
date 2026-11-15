// spawn_clones: `count` small, weightless clone bodies (effect kind 'clone', drawn translucent by the
// renderer) that live for `lifetimeMs` and steer toward the target every step:
//   charge   - fly straight at the target's torso,
//   surround - circle the target on a tight, rotating ring so they keep bumping it,
//   mirror   - appear on the far side of the target and charge it from behind.
// Steering only sets the velocity of the clone bodies themselves; the target is moved solely by contacts.
import { PHYSICS_HZ } from '../../core/config';
import { SPAWN_CLONES } from '../../core/moveblock/primitiveSchemas';
import type { Vec2 } from '../../core/scenario/types';
import type { EffectInfo } from '../world';
import { msToSteps, readParams, topY, torsoPosition } from './shared';
import type { MovePrimitiveImpl } from './types';

type CloneSource = 'hair' | 'shadow' | 'body';
type CloneBehavior = 'charge' | 'surround' | 'mirror';

export const CLONE_HALF_EXTENTS = { hx: 0.08, hy: 0.2 } as const;
/** About 0.06 kg, so a clone at full speed carries roughly 0.3 N·s. */
const CLONE_DENSITY = 1;
/** Cruise speed of a clone in m/s. */
export const CLONE_SPEED = 4;
/** Fraction of the velocity error corrected per step. */
const STEER_GAIN = 0.25;
/** Radius and angular speed of the surround ring. */
const RING_RADIUS_M = 0.3;
const RING_RAD_PER_S = 3;
/** Clones appear at least this far in front of the actor, clear of its body. */
const SPAWN_AHEAD_M = 0.7;

export const spawnClones: MovePrimitiveImpl = {
  name: SPAWN_CLONES.name,
  descriptor: SPAWN_CLONES,
  apply(ctx, raw) {
    const p = readParams(SPAWN_CLONES, raw);
    const count = p.count as number;
    const source = p.source as CloneSource;
    const lifetimeSteps = Math.max(1, msToSteps(p.lifetimeMs as number));
    const behavior = p.behavior as CloneBehavior;
    const jitter = Array.from({ length: count }, () => ({ x: ctx.rng.range(-0.05, 0.05), y: ctx.rng.range(-0.05, 0.05) }));
    const phase0 = ctx.rng.range(0, 2 * Math.PI);
    const clones: EffectInfo[] = [];

    ctx.at(0, () => {
      const { world, actorId, targetId } = ctx;
      const actor = torsoPosition(world, actorId);
      const target = torsoPosition(world, targetId);
      const dir = Math.sign(target.x - actor.x) || world.ragdoll(actorId).facing;
      // Spawn anchor: overhead for hair, low for shadow, torso height for body. Mirror clones
      // appear on the far side of the target instead.
      const baseY = source === 'hair' ? topY(world, actorId) + 0.3 : source === 'shadow' ? 0.3 : actor.y;
      const anchorX = behavior === 'mirror' ? target.x + dir * 1.2 : actor.x + dir * SPAWN_AHEAD_M;
      const cols = 2;
      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const pos: Vec2 = {
          x: anchorX + dir * col * (2 * CLONE_HALF_EXTENTS.hx + 0.1) + jitter[i]!.x,
          y: Math.max(baseY + (row - 1) * (2 * CLONE_HALF_EXTENTS.hy + 0.08), CLONE_HALF_EXTENTS.hy + 0.05) + jitter[i]!.y,
        };
        clones.push(
          ctx.spawn({
            kind: 'clone',
            shape: { type: 'cuboid', ...CLONE_HALF_EXTENTS },
            position: pos,
            density: CLONE_DENSITY,
            gravityScale: 0,
            friction: 0.3,
            restitution: 0.2,
            lifetimeSteps,
          }),
        );
      }
    });

    ctx.every(0, lifetimeSteps - 1, (offset) => {
      const { world, targetId } = ctx;
      const target = torsoPosition(world, targetId);
      clones.forEach((c, i) => {
        if (!world.effects().some((e) => e.id === c.id)) return; // expired
        const body = world.effectBody(c.id);
        const at = body.translation();
        let goal = target;
        if (behavior === 'surround') {
          const a = phase0 + (2 * Math.PI * i) / count + (RING_RAD_PER_S * offset) / PHYSICS_HZ;
          goal = { x: target.x + Math.cos(a) * RING_RADIUS_M, y: target.y + Math.sin(a) * RING_RADIUS_M };
        }
        const dx = goal.x - at.x;
        const dy = goal.y - at.y;
        const d = Math.hypot(dx, dy);
        const want = d > 1e-6 ? { x: (dx / d) * CLONE_SPEED, y: (dy / d) * CLONE_SPEED } : { x: 0, y: 0 };
        const v = body.linvel();
        body.setLinvel({ x: v.x + (want.x - v.x) * STEER_GAIN, y: v.y + (want.y - v.y) * STEER_GAIN }, true);
        body.setAngvel(body.angvel() * (1 - STEER_GAIN), true);
      });
    });
  },
};
