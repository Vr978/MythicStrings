import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, PROJECTILE_VOLLEY } from './primitiveSchemas';
import { PrimitiveRegistry } from './registry';

describe('PrimitiveRegistry', () => {
  it('rejects a duplicate name, names it, and keeps the existing entry', () => {
    const registry = createDefaultRegistry();
    const impostor = { name: 'projectile_volley', version: 2, paramSchema: [] };

    const result = registry.register(impostor);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('duplicate_primitive');
      expect(result.error.name).toBe('projectile_volley');
      expect(result.error.message).toContain('projectile_volley');
    }
    expect(registry.get('projectile_volley')).toBe(PROJECTILE_VOLLEY);
    expect(registry.list()).toHaveLength(4);
  });

  it('lists primitives in registration order, including later additions', () => {
    const registry = createDefaultRegistry();
    expect(registry.list().map((p) => p.name)).toEqual([
      'apply_impulse',
      'projectile_volley',
      'spawn_clones',
      'summon_object',
    ]);

    const added = registry.register({ name: 'dash', version: 1, paramSchema: [] });
    expect(added.ok).toBe(true);
    expect(registry.list().map((p) => p.name).at(-1)).toBe('dash');
    expect(registry.has('dash')).toBe(true);
  });

  it('returns undefined for unknown names', () => {
    expect(new PrimitiveRegistry().get('nope')).toBeUndefined();
  });
});
