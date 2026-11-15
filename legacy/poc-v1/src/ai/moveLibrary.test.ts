import { describe, expect, it } from 'vitest';
import type { MoveBlock } from '../core/moveblock/types';
import { DEFAULT_STORAGE_KEY, LocalMoveLibrary, type StorageLike } from './moveLibrary';

const volley = (count: number, displayName = 'Arrow Rain'): MoveBlock => ({
  schemaVersion: 1,
  displayName,
  description: 'A storm of arrows falls on the foe.',
  primitives: [{ primitive: 'projectile_volley', params: { count, projectileShape: 'arrow', speed: 30, spreadDeg: 10, intervalMs: 20 } }],
  targets: { primary: 'selected_opponent', affects: 'primary_only' },
});

const boulder: MoveBlock = {
  schemaVersion: 1,
  displayName: 'Falling Rock',
  description: 'A boulder crashes down from above.',
  primitives: [{ primitive: 'summon_object', params: { object: 'boulder', sizeScale: 1, dropHeight: 4 } }],
  targets: { primary: 'selected_opponent', affects: 'primary_only' },
};

class MapStorage implements StorageLike {
  readonly data = new Map<string, string>();
  failWrites = false;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error('quota exceeded');
    this.data.set(k, v);
  }
}

function make(storage: StorageLike | null = null) {
  let t = 1000;
  let n = 0;
  return new LocalMoveLibrary({ storage, now: () => (t += 10), newId: () => `e${++n}` });
}

describe('LocalMoveLibrary', () => {
  it('returns no entry and score 0 when empty', async () => {
    const lib = make();
    expect(await lib.nearest('fire arrows')).toEqual({ ok: true, value: { entry: null, score: 0 } });
    expect(await lib.topK('fire', 5)).toEqual([]);
    expect(await lib.size()).toBe(0);
  });

  it('stores a new entry with usage 0 and finds it by exact prompt with score 1', async () => {
    const lib = make();
    const r = await lib.store(volley(10), 'Fire 10 arrows!', 'p1');
    expect(r.ok && r.value.created).toBe(true);
    const n = await lib.nearest('Fire 10 arrows!');
    expect(n.ok && n.value.score).toBe(1);
    expect(n.ok && n.value.entry).toMatchObject({ id: 'e1', creatorId: 'p1', usageCount: 0, prompts: ['Fire 10 arrows!'] });
  });

  it('counts usage exactly once per increment and ignores unknown IDs', async () => {
    const lib = make();
    await lib.store(volley(10), 'fire arrows', 'p1');
    await lib.incrementUsage('e1');
    await lib.incrementUsage('e1');
    await lib.incrementUsage('missing');
    const n = await lib.nearest('fire arrows');
    expect(n.ok && n.value.entry?.usageCount).toBe(2);
  });

  it('links equivalent blocks to the existing entry and keeps creator and creation time', async () => {
    const lib = make();
    const first = await lib.store(volley(10), 'fire 10 arrows', 'p1');
    const second = await lib.store(volley(10, 'Other Name'), 'loose ten arrows', 'p2');
    expect(second.ok && second.value.created).toBe(false);
    expect(await lib.size()).toBe(1);
    const linked = await lib.nearest('loose ten arrows');
    expect(linked.ok && linked.value.score).toBe(1);
    expect(linked.ok && linked.value.entry).toMatchObject({
      id: 'e1',
      creatorId: 'p1',
      createdAt: first.ok ? first.value.entry.createdAt : -1,
      prompts: ['fire 10 arrows', 'loose ten arrows'],
    });
  });

  it('scores quantity-only prompt differences at or above the 0.85 reuse threshold', async () => {
    const lib = make();
    await lib.store(volley(10), 'fire 10 arrows', 'p1');
    await lib.store(boulder, 'drop a boulder', 'p1');
    const n = await lib.nearest('fire 50 arrows');
    expect(n.ok && n.value.entry?.id).toBe('e1');
    expect(n.ok && n.value.score).toBeGreaterThanOrEqual(0.85);
  });

  it('prefers an exact match over another entry that also scores 1', async () => {
    const lib = make();
    await lib.store(volley(50), 'fire 50 arrows', 'p1');
    await lib.store(volley(10), 'fire 10 arrows', 'p1');
    await lib.incrementUsage('e1');
    const n = await lib.nearest('fire 10 arrows');
    expect(n.ok && n.value.entry?.id).toBe('e2');
  });

  it('topK matches display names and descriptions, best first, at most k', async () => {
    const lib = make();
    await lib.store(volley(10), 'arjun attack', 'p1');
    await lib.store(boulder, 'bhima smash', 'p1');
    const hits = await lib.topK('boulder', 5);
    expect(hits.map((h) => h.id)).toEqual(['e2']);
    expect(await lib.topK('arjun boulder', 1)).toHaveLength(1);
  });

  it('rejects blocks that do not conform to the schema', async () => {
    const lib = make();
    const r = await lib.store(volley(1000), 'fire', 'p1');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('invalid_block');
    expect(await lib.size()).toBe(0);
  });

  it('persists under one key and reloads entries in a new instance', async () => {
    const storage = new MapStorage();
    const lib = make(storage);
    await lib.store(volley(10), 'fire arrows', 'p1');
    await lib.store(volley(10), 'shoot arrows', 'p2');
    await lib.incrementUsage('e1');
    expect([...storage.data.keys()]).toEqual([DEFAULT_STORAGE_KEY]);
    const reloaded = make(storage);
    const n = await reloaded.nearest('shoot arrows');
    expect(n.ok && n.value.entry).toMatchObject({ id: 'e1', usageCount: 1, creatorId: 'p1', block: volley(10) });
  });

  it('leaves no partial entry when the write fails', async () => {
    const storage = new MapStorage();
    const lib = make(storage);
    await lib.store(volley(10), 'fire arrows', 'p1');
    storage.failWrites = true;
    const created = await lib.store(boulder, 'drop boulder', 'p1');
    const linked = await lib.store(volley(10), 'shoot arrows', 'p1');
    expect(!created.ok && created.error.kind).toBe('storage_failed');
    expect(linked.ok).toBe(false);
    expect(await lib.size()).toBe(1);
    const n = await lib.nearest('shoot arrows');
    expect(n.ok && n.value.entry?.prompts).toEqual(['fire arrows']);
    expect(n.ok && n.value.score).toBeLessThan(1);
  });

  it('starts empty on corrupt storage and skips records that no longer parse', async () => {
    const storage = new MapStorage();
    storage.data.set(DEFAULT_STORAGE_KEY, '{not json');
    expect(await make(storage).size()).toBe(0);
    storage.data.set(DEFAULT_STORAGE_KEY, JSON.stringify({ version: 1, entries: [{ id: 'x', block: '{}', creatorId: 'p', createdAt: 1, usageCount: 0, prompts: ['a'] }] }));
    expect(await make(storage).size()).toBe(0);
  });

  it('does not let callers mutate stored entries', async () => {
    const lib = make();
    const r = await lib.store(volley(10), 'fire arrows', 'p1');
    if (r.ok) r.value.entry.prompts.push('hacked');
    const n = await lib.nearest('hacked');
    expect(n.ok && n.value.score).toBeLessThan(1);
  });
});
