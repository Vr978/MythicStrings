// Move_Generator (design: "Move_Generator"). The PoC uses a keyword/template generator; an
// LLM-backed generator can implement the same interface later. Every output goes through
// `printMoveBlock` + `parseMoveBlock` and `validateGeneratedMeta` before it is returned (Req 9.2, 9.6).
import { applyParamAdjustments, type ParamChange } from '../core/moveblock/adjust';
import { codePointLength, GENERATED_DESCRIPTION_MAX, GENERATED_NAME_MAX, GENERATED_NOTE_MAX, validateGeneratedMeta } from '../core/moveblock/meta';
import { parseMoveBlock } from '../core/moveblock/parse';
import { createDefaultRegistry } from '../core/moveblock/primitiveSchemas';
import { printMoveBlock } from '../core/moveblock/print';
import type { RegistryView } from '../core/moveblock/registry';
import {
  err,
  MOVE_BLOCK_SCHEMA_VERSION,
  ok,
  type MoveBlock,
  type ParamValue,
  type PrimitiveInvocation,
  type Result,
  type TargetRules,
} from '../core/moveblock/types';
import { findNumbers, type FoundNumber } from '../core/text/numbers';

export interface GenContext {
  /** Registry to build against; defaults to the generator's own registry (Req 12.3). */
  registry?: RegistryView;
  /** Target rules for the new block; defaults to the selected opponent only. */
  targets?: TargetRules;
}

export interface GeneratedMove {
  block: MoveBlock;
  /** Names omitted, substituted, or clamped effects; at most 200 characters (Req 9.5). */
  note?: string;
}

export type GenError =
  | { kind: 'invalid_output'; reason: string }
  | { kind: 'no_primitive'; reason: string }
  | { kind: 'adjust_rejected'; reason: string };

export interface MoveGenerator {
  generate(prompt: string, ctx?: GenContext): Promise<Result<GeneratedMove, GenError>>;
  adjust(block: MoveBlock, prompt: string, ctx?: GenContext): Promise<Result<MoveBlock, GenError>>;
}

/** Most invocations in one Move_Block (Move_Block schema). */
export const MAX_INVOCATIONS = 10;

const DEFAULT_TARGETS: TargetRules = { primary: 'selected_opponent', affects: 'primary_only' };

// ---------------------------------------------------------------------------------------------
// Keyword tables

type Kind = 'projectile_volley' | 'spawn_clones' | 'apply_impulse' | 'summon_object';

/** Trigger words, matched against whole lowercase words. */
const TRIGGERS: readonly { re: RegExp; kind: Kind }[] = [
  { re: /^(arrows?|volleys?|volleyed|shoots?|shooting|shot|spears?|javelins?|fireballs?|discs?|discus|chakrams?|stones|pebbles)$/, kind: 'projectile_volley' },
  { re: /^(clones?|cloned|hairs?|copy|copies|duplicates?|shadows?|illusions?)$/, kind: 'spawn_clones' },
  { re: /^(maces?|clubs?|strikes?|striking|punch(es)?|punching|charges?|charging|kicks?|kicking|smash(es)?|slams?|bash(es)?|ram|tackles?)$/, kind: 'apply_impulse' },
  { re: /^(boulders?|rocks?|summons?|summoning|walls?|wheels?|serpents?|snakes?)$/, kind: 'summon_object' },
];

const has = (words: readonly string[], re: RegExp) => words.some((w) => re.test(w));
const FAST = /^(fast|faster|rapid|rapidly|swift|swiftly|quick|quickly|speedy)$/;
const MIGHTY = /^(mighty|powerful|heavy|crushing|huge|massive|giant|great|thunderous)$/;

/** Effects no registered primitive can express, with the closest supported template. */
const UNSUPPORTED: readonly { re: RegExp; label: string; closest: Kind; hint: string[] }[] = [
  { re: /^(teleports?|teleporting|teleportation|blinks?|warps?)$/, label: 'teleport', closest: 'apply_impulse', hint: ['charge'] },
  { re: /^(fly|flies|flying|flight|soars?|soaring|levitates?|levitating|hover)$/, label: 'flight', closest: 'apply_impulse', hint: ['charge'] },
  { re: /^(invisible|invisibility|vanish(es)?|disappears?)$/, label: 'invisibility', closest: 'spawn_clones', hint: ['shadow'] },
  { re: /^(heals?|healing|regenerates?|restore)$/, label: 'healing', closest: 'apply_impulse', hint: ['strike'] },
  { re: /^(freezes?|freezing|ice|icy|frost)$/, label: 'freezing', closest: 'projectile_volley', hint: ['stones'] },
  { re: /^(lightning|thunderbolts?|thunder|electric)$/, label: 'lightning', closest: 'projectile_volley', hint: ['fireball'] },
  { re: /^(explodes?|explosions?|blasts?|bombs?)$/, label: 'explosion', closest: 'projectile_volley', hint: ['fireball'] },
  { re: /^(poisons?|poisoned|venom)$/, label: 'poison', closest: 'projectile_volley', hint: ['arrow'] },
  { re: /^(shields?|block|defend|barrier)$/, label: 'shielding', closest: 'summon_object', hint: ['wall'] },
  { re: /^(earthquakes?|quake)$/, label: 'earthquake', closest: 'summon_object', hint: ['boulder'] },
  { re: /^(winds?|tornado|storm|gale)$/, label: 'wind', closest: 'projectile_volley', hint: ['disc'] },
  { re: /^(water|flood|waves?|tsunami)$/, label: 'water', closest: 'projectile_volley', hint: ['stones'] },
  { re: /^(curse|curses|hypnoti[sz]e|sleep)$/, label: 'curse', closest: 'spawn_clones', hint: ['illusion'] },
];

// ---------------------------------------------------------------------------------------------
// Templates. Defaults are tuned so the Move visibly reaches a target ~3 m away: impulses of at
// least 2000, short volley intervals, and modest spawn counts.

interface Draft {
  kind: Kind;
  params: Record<string, ParamValue>;
  name: string;
  phrase: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const cap = (s: string) => s.replace(/(^|\s|-)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());

function volleyDraft(words: readonly string[], count: number | undefined): Draft {
  const shape = has(words, /^(spears?|javelins?)$/)
    ? 'spear'
    : has(words, /^(discs?|discus|chakrams?)$/)
      ? 'disc'
      : has(words, /^(stones?|pebbles?)$/)
        ? 'stone'
        : has(words, /^(fireballs?|flaming|fiery|burning)$/)
          ? 'fireball'
          : 'arrow';
  const fast = has(words, FAST);
  const n = count ?? 12;
  const spread = has(words, /^(rain|raining|spread|wide|storm|hail)$/) ? 30 : 10;
  const nouns: Record<string, [string, string]> = {
    arrow: ['arrow', 'arrows'],
    spear: ['spear', 'spears'],
    disc: ['disc', 'discs'],
    stone: ['stone', 'stones'],
    fireball: ['fireball', 'fireballs'],
  };
  const [one, many] = nouns[shape]!;
  return {
    kind: 'projectile_volley',
    params: { count: n, projectileShape: shape, speed: fast ? 45 : 25, spreadDeg: spread, intervalMs: fast ? 60 : 80 },
    name: `${fast ? 'Rapid ' : ''}Volley of ${n} ${cap(plural(n, one, many))}`,
    phrase: `looses ${n === 1 ? `a ${one}` : `${n} ${many}`}${fast ? ' at speed' : ''}`,
  };
}

function clonesDraft(words: readonly string[], count: number | undefined): Draft {
  const source = has(words, /^(hairs?|strands?)$/) ? 'hair' : has(words, /^(shadows?|illusions?|illusory|invisible|invisibility|vanish(es)?)$/) ? 'shadow' : 'body';
  const behavior = has(words, /^(surround|surrounds|surrounding|circle|encircle|ring)$/)
    ? 'surround'
    : has(words, /^(mirror|mirrors|behind|flank|flanking)$/)
      ? 'mirror'
      : 'charge';
  const n = count ?? 4;
  const adj = source === 'body' ? 'puppet' : source;
  const action = behavior === 'surround' ? 'surround the foe' : behavior === 'mirror' ? 'strike from behind' : 'charge the foe';
  return {
    kind: 'spawn_clones',
    params: { count: n, source, lifetimeMs: 3000, behavior },
    name: `${cap(adj)} Clones`,
    phrase: `conjures ${n} ${adj} ${plural(n, 'clone that', 'clones that')} ${n === 1 ? action.replace(/^(\w+)/, '$1s') : action}`,
  };
}

function impulseDraft(words: readonly string[]): Draft {
  const mighty = has(words, MIGHTY);
  const fast = has(words, FAST);
  let segment = 'hand';
  let name = 'Strike';
  let phrase = 'strikes the foe';
  let magnitude = 2500;
  let angleDeg = 0;
  if (has(words, /^(maces?|clubs?|smash(es)?|bash(es)?)$/)) {
    const club = has(words, /^clubs?$/) ? 'club' : 'mace';
    segment = 'accessory';
    name = `${cap(club)} Strike`;
    phrase = `swings a ${club} into the foe`;
    magnitude = 3000;
    angleDeg = 15;
  } else if (has(words, /^(punch(es)?|punching|fists?)$/)) {
    name = 'Punch';
    phrase = 'throws a punch at the foe';
  } else if (has(words, /^(kicks?|kicking)$/)) {
    segment = 'foot';
    name = 'Kick';
    phrase = 'lands a kick on the foe';
  } else if (has(words, /^(charges?|charging|ram|tackles?)$/) || !has(words, /^(strikes?|striking|slams?)$/)) {
    segment = 'torso';
    name = 'Charge';
    phrase = 'charges into the foe';
    magnitude = 3000;
  }
  if (mighty) magnitude = 4000;
  if (fast) magnitude = Math.max(magnitude, 3500);
  return {
    kind: 'apply_impulse',
    params: { segment, magnitude, angleDeg },
    name: `${mighty ? 'Mighty ' : fast ? 'Swift ' : ''}${name}`,
    phrase,
  };
}

function summonDraft(words: readonly string[]): Draft {
  const object = has(words, /^walls?$/)
    ? 'wall'
    : has(words, /^wheels?$/)
      ? 'chariot_wheel'
      : has(words, /^(serpents?|snakes?)$/)
        ? 'serpent'
        : 'boulder';
  const big = has(words, MIGHTY);
  const small = has(words, /^(small|tiny|little)$/);
  const label = object === 'chariot_wheel' ? 'chariot wheel' : object;
  const size = big ? 'huge ' : small ? 'small ' : '';
  return {
    kind: 'summon_object',
    params: { object, sizeScale: big ? 2 : small ? 0.6 : 1.2, dropHeight: 4 },
    name: `Summoned ${cap(size + label)}`,
    phrase: `drops a ${size}${label} on the foe`,
  };
}

function draftFor(kind: Kind, words: readonly string[], count: number | undefined): Draft {
  switch (kind) {
    case 'projectile_volley':
      return volleyDraft(words, count);
    case 'spawn_clones':
      return clonesDraft(words, count);
    case 'apply_impulse':
      return impulseDraft(words);
    case 'summon_object':
      return summonDraft(words);
  }
}

const COUNTED: ReadonlySet<Kind> = new Set(['projectile_volley', 'spawn_clones']);

// ---------------------------------------------------------------------------------------------
// Text analysis

interface Clause {
  words: string[];
  numbers: FoundNumber[];
}

/**
 * Splits the prompt into clauses at punctuation and at "and"/"then", except where "and" is part
 * of a number ("one hundred and five"). Each clause keeps its words and the numbers starting in it.
 */
function clauses(prompt: string, numbers: readonly FoundNumber[]): Clause[] {
  const lower = prompt.toLowerCase();
  const inNumber = (i: number) => numbers.some((n) => i >= n.start && i < n.end);
  const cuts: number[] = [0];
  for (const m of lower.matchAll(/[,;:.!?]|\b(?:and|then|while)\b/g)) {
    if (/[.,]/.test(m[0]) && /\d/.test(lower[m.index - 1] ?? '') && /\d/.test(lower[m.index + 1] ?? '')) continue;
    if (!inNumber(m.index)) cuts.push(m.index);
  }
  cuts.push(lower.length);
  const out: Clause[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i]!, cuts[i + 1]!];
    const words = [...lower.slice(a, b).matchAll(/[a-z]+/g)].map((m) => m[0]);
    out.push({ words, numbers: numbers.filter((n) => n.start >= a && n.start < b) });
  }
  return out;
}

const truncate = (s: string, max: number) => {
  const cps = [...s];
  return cps.length <= max ? s : `${cps.slice(0, max - 1).join('').trimEnd()}…`;
};

function joinNote(parts: readonly string[]): string | undefined {
  return parts.length === 0 ? undefined : truncate(parts.join(' '), GENERATED_NOTE_MAX);
}

function displayName(drafts: readonly Draft[]): string {
  const first = drafts[0]!.name;
  let name = first;
  if (drafts.length === 2) {
    name = `${first} & ${drafts[1]!.name}`;
    if (codePointLength(name) > GENERATED_NAME_MAX) name = `${first} Combo`;
  } else if (drafts.length > 2) name = `${first} Combo`;
  return truncate(name, GENERATED_NAME_MAX);
}

function description(drafts: readonly Draft[]): string {
  const sentence = (phrases: readonly string[], more: boolean) => {
    let body: string;
    if (phrases.length === 1) body = phrases[0]!;
    else body = `${phrases.slice(0, -1).join(', ')}, then ${phrases[phrases.length - 1]!}`;
    return `The puppet ${body}${more ? ', and more' : ''}.`;
  };
  const phrases = drafts.map((d) => d.phrase);
  for (let k = phrases.length; k >= 1; k--) {
    const s = sentence(phrases.slice(0, k), k < phrases.length);
    if (codePointLength(s) <= GENERATED_DESCRIPTION_MAX) return s;
  }
  return truncate(sentence(phrases.slice(0, 1), false).slice(0, -1), GENERATED_DESCRIPTION_MAX - 1) + '.';
}

// ---------------------------------------------------------------------------------------------

export class KeywordMoveGenerator implements MoveGenerator {
  readonly #registry: RegistryView;

  constructor(registry: RegistryView = createDefaultRegistry()) {
    this.#registry = registry;
  }

  async generate(prompt: string, ctx: GenContext = {}): Promise<Result<GeneratedMove, GenError>> {
    const registry = ctx.registry ?? this.#registry;
    const numbers = findNumbers(prompt);
    const allWords = [...prompt.toLowerCase().matchAll(/[a-z]+/g)].map((m) => m[0]);
    const notes: string[] = [];

    // Effects in text order; one invocation per primitive kind per clause.
    let drafts: Draft[] = [];
    const missing = new Set<string>();
    for (const clause of clauses(prompt, numbers)) {
      const kinds: Kind[] = [];
      for (const w of clause.words) {
        const t = TRIGGERS.find((tr) => tr.re.test(w));
        if (t && !kinds.includes(t.kind)) kinds.push(t.kind);
      }
      let numberUsed = false;
      for (const kind of kinds) {
        if (!registry.has(kind)) {
          missing.add(kind);
          continue;
        }
        let count = COUNTED.has(kind) && !numberUsed ? clause.numbers[0]?.value : undefined;
        if (count !== undefined) {
          numberUsed = true;
          const spec = registry.get(kind)?.paramSchema.find((p) => p.name === 'count');
          if (spec && (spec.type === 'integer' || spec.type === 'number')) {
            const c = Math.min(spec.max, Math.max(spec.min, spec.type === 'integer' ? Math.round(count) : count));
            if (c !== count) notes.push(`Clamped ${kind === 'spawn_clones' ? 'clone' : 'projectile'} count ${count} to ${c}.`);
            count = c;
          }
        }
        drafts.push(draftFor(kind, clause.words, count));
      }
    }

    const unsupported = UNSUPPORTED.filter((u) => has(allWords, u.re));
    if (drafts.length === 0) {
      const template = unsupported.find((u) => registry.has(u.closest));
      const fallbackKind: Kind | undefined = template?.closest ?? (['apply_impulse', 'projectile_volley', 'spawn_clones', 'summon_object'] as const).find((k) => registry.has(k));
      if (!fallbackKind) return err({ kind: 'no_primitive', reason: 'no known Move_Primitive is registered' });
      const d = draftFor(fallbackKind, [...allWords, ...(template?.hint ?? [])], undefined);
      drafts = [d];
      const what = unsupported.length > 0 ? unsupported.map((u) => u.label).join(', ') : `"${truncate(prompt.trim(), 60)}"`;
      notes.push(`Unsupported effect: ${what}. Substituted the closest move, ${d.name}.`);
    } else if (unsupported.length > 0) {
      notes.push(`Omitted unsupported effect: ${unsupported.map((u) => u.label).join(', ')}.`);
    }
    if (missing.size > 0) notes.push(`Omitted effects with no registered primitive: ${[...missing].join(', ')}.`);
    if (drafts.length > MAX_INVOCATIONS) {
      notes.push(`Kept the first ${MAX_INVOCATIONS} effects and omitted ${drafts.length - MAX_INVOCATIONS} more.`);
      drafts = drafts.slice(0, MAX_INVOCATIONS);
    }

    // Template values are in range for the default schemas; clamp anyway in case a registry
    // carries narrower bounds, noting every value that had to change.
    const primitives: PrimitiveInvocation[] = drafts.map((d) => {
      const params = { ...d.params };
      for (const spec of registry.get(d.kind)?.paramSchema ?? []) {
        if (spec.type !== 'number' && spec.type !== 'integer') continue;
        const v = params[spec.name];
        if (typeof v !== 'number') continue;
        const c = Math.min(spec.max, Math.max(spec.min, spec.type === 'integer' ? Math.round(v) : v));
        if (c !== v) {
          notes.push(`Clamped ${spec.name} ${v} to ${c}.`);
          params[spec.name] = c;
        }
      }
      return { primitive: d.kind, params };
    });

    const block: MoveBlock = {
      schemaVersion: MOVE_BLOCK_SCHEMA_VERSION,
      displayName: displayName(drafts),
      description: description(drafts),
      primitives,
      targets: { ...(ctx.targets ?? DEFAULT_TARGETS) },
    };
    const note = joinNote(notes);
    const checked = checkBlock(block, registry);
    if (!checked.ok) return checked;
    const meta = validateGeneratedMeta({ displayName: block.displayName, description: block.description, note });
    if (!meta.ok) return err({ kind: 'invalid_output', reason: meta.error.reason });
    return ok(note === undefined ? { block: checked.value } : { block: checked.value, note });
  }

  /**
   * Sets the k-th number in `prompt` as the `count` of the k-th invocation that has a `count`
   * parameter, clamped to the schema. Primitives, their order, and all other values are kept;
   * the input block is not mutated (Req 14.4).
   */
  async adjust(block: MoveBlock, prompt: string, ctx: GenContext = {}): Promise<Result<MoveBlock, GenError>> {
    const registry = ctx.registry ?? this.#registry;
    const numbers = findNumbers(prompt);
    const counted = block.primitives
      .map((inv, index) => ({ inv, index }))
      .filter(({ inv }) => registry.get(inv.primitive)?.paramSchema.some((p) => p.name === 'count' && p.type !== 'enum' && p.type !== 'boolean'));
    const changes: ParamChange[] = counted
      .slice(0, numbers.length)
      .map(({ index }, k) => ({ index, param: 'count', value: numbers[k]!.value }));
    const { block: adjusted, rejected } = applyParamAdjustments(block, changes, registry);
    if (rejected.length > 0) return err({ kind: 'adjust_rejected', reason: rejected[0]!.reason });
    return checkBlock(adjusted, registry);
  }
}

/** Round-trips the block through the printer and parser so only schema-conformant output leaves. */
function checkBlock(block: MoveBlock, registry: RegistryView): Result<MoveBlock, GenError> {
  const printed = printMoveBlock(block, registry);
  if (!printed.ok) return err({ kind: 'invalid_output', reason: printed.error.reason });
  const parsed = parseMoveBlock(printed.value, registry);
  if (!parsed.ok) return err({ kind: 'invalid_output', reason: parsed.error.reason });
  return ok(parsed.value);
}
