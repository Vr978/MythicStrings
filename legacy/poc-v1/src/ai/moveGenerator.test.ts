import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, parseMoveBlock, printMoveBlock, validateGeneratedMeta, type MoveBlock } from '../core/moveblock';
import { KeywordMoveGenerator, type GeneratedMove } from './moveGenerator';

const registry = createDefaultRegistry();
const gen = new KeywordMoveGenerator(registry);

async function generate(prompt: string): Promise<GeneratedMove> {
  const r = await gen.generate(prompt);
  if (!r.ok) throw new Error(`generation failed: ${r.error.reason}`);
  const { block, note } = r.value;
  // Every output conforms to the schema and to the generator metadata limits (Req 9.2, 9.6).
  const printed = printMoveBlock(block, registry);
  expect(printed.ok).toBe(true);
  if (printed.ok) expect(parseMoveBlock(printed.value, registry).ok).toBe(true);
  expect(validateGeneratedMeta({ displayName: block.displayName, description: block.description, note }).ok).toBe(true);
  return r.value;
}

const names = (b: MoveBlock) => b.primitives.map((p) => p.primitive);

describe('KeywordMoveGenerator.generate', () => {
  it('"fire a volley of a hundred arrows" gives a projectile_volley with count 100', async () => {
    const { block, note } = await generate('fire a volley of a hundred arrows');
    expect(names(block)).toEqual(['projectile_volley']);
    expect(block.primitives[0]!.params).toMatchObject({ count: 100, projectileShape: 'arrow' });
    expect(note).toBeUndefined();
  });

  it('"make clones from strands of hair" gives spawn_clones from hair', async () => {
    const { block } = await generate('make clones from strands of hair');
    expect(names(block)).toEqual(['spawn_clones']);
    expect(block.primitives[0]!.params.source).toBe('hair');
  });

  it('"summon a boulder and strike with my mace" gives two invocations in text order', async () => {
    const { block } = await generate('summon a boulder and strike with my mace');
    expect(names(block)).toEqual(['summon_object', 'apply_impulse']);
    expect(block.primitives[0]!.params.object).toBe('boulder');
    expect(block.primitives[1]!.params.magnitude as number).toBeGreaterThanOrEqual(2000);
  });

  it('unsupported text returns the closest move and a note naming the effect', async () => {
    for (const prompt of ['teleport behind him', 'fly over the battlefield', 'sing a lullaby']) {
      const { block, note } = await generate(prompt);
      expect(block.primitives.length).toBe(1);
      expect(note).toBeDefined();
      expect([...note!].length).toBeLessThanOrEqual(200);
    }
    expect((await generate('teleport behind him')).note).toContain('teleport');
    expect((await generate('fly over the battlefield')).note).toContain('flight');
  });

  it('names omitted effects when supported ones are also present', async () => {
    const { block, note } = await generate('teleport and then punch');
    expect(names(block)).toEqual(['apply_impulse']);
    expect(note).toContain('teleport');
  });

  it('clamps out-of-range counts and notes it', async () => {
    const { block, note } = await generate('shoot a thousand arrows');
    expect(block.primitives[0]!.params.count).toBe(100);
    expect(note).toMatch(/1000.*100/);
    const clones = await generate('twenty clones surround him');
    expect(clones.block.primitives[0]!.params).toMatchObject({ count: 8, behavior: 'surround' });
    expect(clones.note).toContain('20');
  });

  it('maps flavor words', async () => {
    const spears = await generate('throw spears');
    expect(spears.block.primitives[0]!.params.projectileShape).toBe('spear');
    const fast = await generate('rapid volley of 10 arrows');
    const slow = await generate('volley of 10 arrows');
    expect(fast.block.primitives[0]!.params.speed as number).toBeGreaterThan(slow.block.primitives[0]!.params.speed as number);
    expect(names((await generate('cast an illusion')).block)).toEqual(['spawn_clones']);
    expect((await generate('shadow army')).block.primitives[0]!.params.source).toBe('shadow');
  });

  it('keeps "one hundred and five" as one number in one clause', async () => {
    const { block } = await generate('a volley of one hundred and five arrows');
    expect(block.primitives).toHaveLength(1);
    expect(block.primitives[0]!.params.count).toBe(100);
  });

  it('caps a block at 10 invocations with a note', async () => {
    const prompt = Array.from({ length: 12 }, () => 'punch').join(', ');
    const { block, note } = await generate(prompt);
    expect(block.primitives).toHaveLength(10);
    expect(note).toContain('omitted 2');
  });

  it('default volleys stay small enough to simulate', async () => {
    const { block } = await generate('shoot arrows');
    expect(block.primitives[0]!.params.count as number).toBeLessThanOrEqual(60);
    expect(block.primitives[0]!.params.intervalMs as number).toBeLessThanOrEqual(100);
  });
});

describe('KeywordMoveGenerator.adjust', () => {
  it('changes only counts to match the new prompt, clamped, keeping primitives and order', async () => {
    const { block } = await generate('summon a boulder and fire 10 arrows');
    const r = await gen.adjust(block, 'summon a boulder and fire 50 arrows');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(names(r.value)).toEqual(names(block));
    expect(r.value.primitives[1]!.params.count).toBe(50);
    expect(r.value.primitives[0]!.params).toEqual(block.primitives[0]!.params);
    expect(block.primitives[1]!.params.count).toBe(10);

    const clamped = await gen.adjust(block, '500 arrows');
    expect(clamped.ok && clamped.value.primitives[1]!.params.count).toBe(100);
  });

  it('returns an equal block when the prompt has no numbers', async () => {
    const { block } = await generate('fire 10 arrows');
    const r = await gen.adjust(block, 'fire arrows');
    expect(r.ok && r.value).toEqual(block);
  });
});
