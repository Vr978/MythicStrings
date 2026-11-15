import { describe, expect, it } from 'vitest';
import { PHYSICS_DT } from '../core/config';
import { loadRapier } from './rapier';

describe('loadRapier', () => {
  it('returns the same module on repeated calls', async () => {
    const [a, b] = await Promise.all([loadRapier(), loadRapier()]);
    expect(a).toBe(b);
  });

  it('creates a world and steps it once', async () => {
    const R = await loadRapier();
    const world = new R.World({ x: 0, y: -9.81 });
    world.timestep = PHYSICS_DT;
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 10));
    world.createCollider(R.ColliderDesc.cuboid(0.5, 0.5), body);

    world.step();

    const y = body.translation().y;
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeLessThan(10);
    world.free();
  });
});
