import { describe, expect, it } from 'vitest';
import {
  canonicalKey,
  clampToSchema,
  createDefaultRegistry,
  equivalentMoveBlocks,
  MAX_DOCUMENT_BYTES,
  parseMoveBlock,
  printMoveBlock,
  type MoveBlock,
  type ParseError,
} from './index';

const registry = createDefaultRegistry();

const rain = (): MoveBlock => ({
  schemaVersion: 1,
  displayName: 'Rain of Arrows',
  description: 'Arjun looses a hundred arrows in a high arc.',
  primitives: [
    {
      primitive: 'projectile_volley',
      params: { count: 100, projectileShape: 'arrow', speed: 35, spreadDeg: 25, intervalMs: 20 },
    },
    { primitive: 'apply_impulse', params: { segment: 'torso', magnitude: 900, angleDeg: 0 } },
  ],
  targets: { primary: 'selected_opponent', affects: 'primary_only' },
});

const docOf = (v: unknown) => JSON.stringify(v, null, 2);

function parseErr(doc: string): ParseError {
  const r = parseMoveBlock(doc, registry);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('expected an error');
  expect('value' in r).toBe(false);
  return r.error;
}

/** Applies `mutate` to a fresh valid block (as plain JSON) and returns the parse error. */
function errAfter(mutate: (b: Record<string, any>) => void): ParseError {
  const b = structuredClone(rain()) as unknown as Record<string, any>;
  mutate(b);
  return parseErr(docOf(b));
}

describe('parseMoveBlock', () => {
  it('parses a conforming document with every field and invocation order kept', () => {
    const r = parseMoveBlock(docOf(rain()), registry);
    expect(r.ok && r.value).toEqual(rain());
  });

  it('rejects documents over 64 KB before parsing', () => {
    const big = `{"x":"${'é'.repeat(MAX_DOCUMENT_BYTES / 2)}"}`; // valid JSON, > 65,536 bytes
    const e = parseErr(big);
    expect(e.kind).toBe('size_limit');
    expect(parseErr(' '.repeat(MAX_DOCUMENT_BYTES + 1)).kind).toBe('size_limit');
  });

  it('accepts a document of exactly 65,536 bytes as far as the size check goes', () => {
    const base = docOf(rain());
    const padded = base + ' '.repeat(MAX_DOCUMENT_BYTES - base.length);
    expect(parseMoveBlock(padded, registry).ok).toBe(true);
  });

  it('reports line and column for malformed JSON', () => {
    const e = parseErr('{\n  "schemaVersion": 1,\n  "displayName": ,\n}');
    expect(e).toMatchObject({ kind: 'syntax', line: 3, column: 18 });
    expect(parseErr('{"a": [1, 2')).toMatchObject({ kind: 'syntax', line: 1, column: 12 });
    expect(parseErr('')).toMatchObject({ kind: 'syntax', line: 1, column: 1 });
    expect(parseErr('{"🏹": tru}')).toMatchObject({ kind: 'syntax', line: 1, column: 7 });
    expect(parseErr('{} x')).toMatchObject({ kind: 'syntax', line: 1, column: 4 });
  });

  it('names an unsupported schema version and an unknown primitive', () => {
    const v = errAfter((b) => (b.schemaVersion = 2));
    expect(v).toMatchObject({ kind: 'schema', path: 'schemaVersion' });
    expect(v.reason).toContain('2');
    const p = errAfter((b) => (b.primitives[1].primitive = 'teleport'));
    expect(p).toMatchObject({ path: 'primitives[1].primitive' });
    expect(p.reason).toContain('teleport');
  });

  it('identifies the invocation index and parameter for missing, mistyped, and out-of-range values', () => {
    expect(errAfter((b) => delete b.primitives[0].params.speed).path).toBe('primitives[0].params.speed');
    expect(errAfter((b) => (b.primitives[1].params.magnitude = '900')).path).toBe('primitives[1].params.magnitude');
    expect(errAfter((b) => (b.primitives[0].params.count = 101)).path).toBe('primitives[0].params.count');
    expect(errAfter((b) => (b.primitives[0].params.count = 2.5)).path).toBe('primitives[0].params.count');
    expect(errAfter((b) => (b.primitives[1].params.segment = 'tail')).path).toBe('primitives[1].params.segment');
    expect(errAfter((b) => (b.primitives[0].params.extra = 1)).path).toBe('primitives[0].params.extra');
  });

  it('reports the first nonconformance in declared parameter order', () => {
    // count is declared before speed in projectile_volley
    const e = errAfter((b) => {
      b.primitives[0].params.speed = 999;
      b.primitives[0].params.count = 0;
    });
    expect(e.path).toBe('primitives[0].params.count');
  });

  it('reports the first nonconformance in fixed field order', () => {
    const e = errAfter((b) => {
      b.targets = 'nobody';
      b.description = '';
      b.displayName = 'x'.repeat(41);
    });
    expect(e.path).toBe('displayName');
  });

  it('enforces invocation count and code-point text lengths', () => {
    expect(errAfter((b) => (b.primitives = [])).path).toBe('primitives');
    expect(errAfter((b) => (b.primitives = Array(11).fill(b.primitives[1]))).path).toBe('primitives');
    expect(errAfter((b) => (b.description = 'a'.repeat(281))).path).toBe('description');
    expect(errAfter((b) => delete b.targets).path).toBe('targets');
    expect(errAfter((b) => (b.targets.affects = 'all')).path).toBe('targets.affects');
    // 40 emoji are 80 UTF-16 units but 40 code points: allowed
    const r = parseMoveBlock(docOf({ ...rain(), displayName: '🏹'.repeat(40) }), registry);
    expect(r.ok).toBe(true);
  });
});

describe('printMoveBlock', () => {
  it('emits canonical JSON matching the design example', () => {
    const block = rain();
    block.primitives = [block.primitives[0]!];
    const r = printMoveBlock(block, registry);
    expect(r.ok && r.value).toBe(
      '{"description":"Arjun looses a hundred arrows in a high arc.","displayName":"Rain of Arrows",' +
        '"primitives":[{"params":{"count":100,"intervalMs":20,"projectileShape":"arrow","speed":35,"spreadDeg":25},' +
        '"primitive":"projectile_volley"}],"schemaVersion":1,"targets":{"affects":"primary_only","primary":"selected_opponent"}}',
    );
  });

  it('is byte-identical for equivalent objects with different key order and -0', () => {
    const a = rain();
    const b: MoveBlock = {
      targets: { affects: 'primary_only', primary: 'selected_opponent' },
      primitives: [
        a.primitives[0]!,
        { params: { angleDeg: -0, magnitude: 900, segment: 'torso' }, primitive: 'apply_impulse' },
      ],
      description: a.description,
      displayName: a.displayName,
      schemaVersion: 1,
    };
    const pa = printMoveBlock(a, registry);
    const pb = printMoveBlock(b, registry);
    expect(pa.ok && pb.ok).toBe(true);
    expect(pa.ok && pb.ok && pa.value === pb.value).toBe(true);
    expect(pb.ok && pb.value.includes('-0')).toBe(false);
  });

  it('round-trips through the parser', () => {
    const printed = printMoveBlock(rain(), registry);
    if (!printed.ok) throw new Error(printed.error.reason);
    const parsed = parseMoveBlock(printed.value, registry);
    expect(parsed.ok && equivalentMoveBlocks(parsed.value, rain())).toBe(true);
  });

  it('rejects a nonconforming object, naming the first bad field, and returns no document', () => {
    const block = rain();
    block.primitives[1]!.params.magnitude = Number.NaN;
    const r = printMoveBlock(block, registry);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.path).toBe('primitives[1].params.magnitude');
    expect('value' in r).toBe(false);
  });
});

describe('equivalence and canonicalKey', () => {
  it('treats display text and targets as part of equivalence but not of the key', () => {
    const a = rain();
    const b = { ...rain(), displayName: 'Arrow Storm', targets: { primary: 'self', affects: 'everyone' } } as MoveBlock;
    expect(equivalentMoveBlocks(a, rain())).toBe(true);
    expect(equivalentMoveBlocks(a, b)).toBe(false);
    expect(canonicalKey(a)).toBe(canonicalKey(b));
    expect(canonicalKey(a)).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
  });

  it('changes with any parameter value or invocation order', () => {
    const changed = rain();
    changed.primitives[0]!.params.count = 99;
    const swapped = rain();
    swapped.primitives.reverse();
    expect(canonicalKey(changed)).not.toBe(canonicalKey(rain()));
    expect(canonicalKey(swapped)).not.toBe(canonicalKey(rain()));
    expect(equivalentMoveBlocks(swapped, rain())).toBe(false);
  });
});

describe('clampToSchema', () => {
  it('moves only out-of-range numeric params to the nearest bound, without mutating input', () => {
    const block = rain();
    block.primitives[0]!.params.count = 500;
    block.primitives[0]!.params.spreadDeg = -3;
    const before = structuredClone(block);
    const { block: out, clamped } = clampToSchema(block, registry);
    expect(clamped).toBe(true);
    expect(out.primitives[0]!.params).toEqual({ ...rain().primitives[0]!.params, count: 100, spreadDeg: 0 });
    expect(out.primitives[1]).toEqual(rain().primitives[1]);
    expect(block).toEqual(before);
    expect(printMoveBlock(out, registry).ok).toBe(true);
    expect(clampToSchema(out, registry).clamped).toBe(false);
  });

  it('reports nothing clamped for an in-range block', () => {
    const r = clampToSchema(rain(), registry);
    expect(r.clamped).toBe(false);
    expect(r.block).toEqual(rain());
  });
});
