import { describe, expect, it } from 'vitest';
import type { MoveBlock } from '../core/moveblock/types';
import { LocalMoveLibrary } from './moveLibrary';
import { LocalRecommendationEngine } from './recommend';

const T = { primary: 'selected_opponent', affects: 'primary_only' } as const;
const volley = (count: number): MoveBlock => ({
  schemaVersion: 1, displayName: `Arrow Rain ${count}`, description: 'A storm of arrows.',
  primitives: [{ primitive: 'projectile_volley', params: { count, projectileShape: 'arrow', speed: 30, spreadDeg: 10, intervalMs: 20 } }],
  targets: T,
});
const mace: MoveBlock = {
  schemaVersion: 1, displayName: 'Gada Drop', description: 'A giant mace falls.',
  primitives: [{ primitive: 'summon_object', params: { object: 'mace', sizeScale: 2, dropHeight: 5 } }],
  targets: T,
};

async function setup() {
  let n = 0;
  const lib = new LocalMoveLibrary({ storage: null, now: () => 0, newId: () => `e${++n}` });
  await lib.store(mace, 'drop a giant mace', 'p2');
  for (let i = 1; i <= 6; i++) await lib.store(volley(i), `shoot ${i} arrows`, 'p1');
  return { lib, engine: new LocalRecommendationEngine(lib) };
}

describe('LocalRecommendationEngine', () => {
  it('forWindow returns at most 5 distinct entries, trait-relevant first', async () => {
    const { engine } = await setup();
    const traits = [{ name: 'Mace Mastery', description: 'Wields the gada.', magnitude: 9 }];
    const r = await engine.forWindow({ traits, actorHP: 100, opponentHP: 100 });
    expect(r).toHaveLength(5);
    expect(new Set(r.map((e) => e.id)).size).toBe(5);
    expect(r[0]!.block.displayName).toBe('Gada Drop');
  });
  it('forTyping uses prompt similarity, at most 5, and nothing for a blank prompt', async () => {
    const { engine } = await setup();
    const r = await engine.forTyping('giant mace');
    expect(r[0]!.block.displayName).toBe('Gada Drop');
    expect((await engine.forTyping('arrows')).length).toBe(5);
    expect(await engine.forTyping('   ')).toEqual([]);
  });
  it('returns empty lists for an empty library', async () => {
    const engine = new LocalRecommendationEngine(new LocalMoveLibrary({ storage: null }));
    expect(await engine.forWindow({ traits: [], actorHP: 100, opponentHP: 100 })).toEqual([]);
    expect(await engine.forTyping('arrows')).toEqual([]);
  });
});
