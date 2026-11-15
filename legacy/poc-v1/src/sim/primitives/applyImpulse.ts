// apply_impulse: a mace strike or charge. The actor lunges toward the target and the chosen segment
// gets an extra strike impulse turned by `angleDeg` from the line to the target (positive is upward).
// Only the actor's own bodies receive forces (Req 2.2); the target is affected solely through the
// resulting contacts.
//
// Scaling: schema magnitudes reach 5000 "N·s", far beyond what a ~0.73 kg puppet can absorb, so the
// magnitude is multiplied by IMPULSE_SCALE and the resulting velocity changes are capped: the whole
// body by MAX_LUNGE_DV and the struck segment by MAX_STRIKE_DV on top of that.
import { APPLY_IMPULSE } from '../../core/moveblock/primitiveSchemas';
import type { SegmentRole } from '../../core/scenario/types';
import { aimPoint, deg2rad, norm, pickSegment, readParams, rotate, segmentMass, sub } from './shared';
import type { MovePrimitiveImpl } from './types';

/** Physical N·s per schema magnitude unit: 5000 maps to 10 N·s (before the caps). */
export const IMPULSE_SCALE = 0.002;
/** Cap on the whole-body velocity change (m/s). Equal on every segment, so joints are not strained. */
export const MAX_LUNGE_DV = 7;
/** Share of the scaled impulse spent on the strike segment rather than the lunge. */
const STRIKE_SHARE = 0.2;
/** Cap on the extra velocity change of the strike segment (m/s). */
export const MAX_STRIKE_DV = 6;
/** Upward hop added to the lunge, as a fraction of its speed, so the feet leave the floor. */
const LUNGE_LIFT = 0.5;

export const applyImpulse: MovePrimitiveImpl = {
  name: APPLY_IMPULSE.name,
  descriptor: APPLY_IMPULSE,
  apply(ctx, raw) {
    const p = readParams(APPLY_IMPULSE, raw);
    const role = p.segment as SegmentRole;
    const magnitude = p.magnitude as number;
    const angleDeg = p.angleDeg as number;

    ctx.at(0, () => {
      const { world, actorId, targetId } = ctx;
      if (magnitude === 0) return;
      const r = world.ragdoll(actorId);
      const target = aimPoint(world, actorId, targetId);
      const segId = pickSegment(world, actorId, role, target);
      const seg = world.segmentTransform(actorId, segId);
      const towards = norm(sub(target, seg));
      // Positive angles turn the push upward on either side of the Stage.
      const side = Math.sign(towards.x) || r.facing;
      const d = rotate(towards, deg2rad(angleDeg) * side);

      const scaled = magnitude * IMPULSE_SCALE;
      const lungeDv = Math.min(((1 - STRIKE_SHARE) * scaled) / r.totalMass, MAX_LUNGE_DV);
      // The lunge always carries the body toward the target; angleDeg steers only the strike.
      const lunge = { x: towards.x * lungeDv, y: towards.y * lungeDv + LUNGE_LIFT * lungeDv };
      for (const s of r.segments) {
        const m = segmentMass(world, actorId, s.id);
        world.applySegmentImpulse(actorId, s.id, { x: lunge.x * m, y: lunge.y * m });
      }
      const m = segmentMass(world, actorId, segId);
      const strikeDv = Math.min((STRIKE_SHARE * scaled) / m, MAX_STRIKE_DV);
      world.applySegmentImpulse(actorId, segId, { x: d.x * strikeDv * m, y: d.y * strikeDv * m });
    });
  },
};
