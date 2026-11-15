// Structural Move_Block_Schema check shared by the Move_Parser and Move_Printer
// (design: "Parsing order" step 3 and 4). Fields are checked in a fixed order so the
// "first nonconformance" is well defined (Req 13.2), and a fresh object is built so the
// caller never receives a partial object or an alias of untrusted input.
import type { RegistryView } from './registry';
import {
  err,
  MOVE_BLOCK_SCHEMA_VERSION,
  ok,
  TARGET_AFFECTS_VALUES,
  TARGET_PRIMARY_VALUES,
  type MoveBlock,
  type ParamSpec,
  type ParamValue,
  type PrimitiveInvocation,
  type Result,
  type TargetRules,
} from './types';

export const DISPLAY_NAME_MAX = 40;
export const DESCRIPTION_MAX = 280;
export const PRIMITIVES_MIN = 1;
export const PRIMITIVES_MAX = 10;

/** A schema nonconformance: where (`path`) and why (`reason`). */
export interface SchemaError {
  kind: 'schema';
  /** Field path such as `displayName` or `primitives[2].params.count`. Empty for the root. */
  path: string;
  reason: string;
}

type Obj = Record<string, unknown>;
type Check<T> = Result<T, SchemaError>;

const fail = (path: string, reason: string): Check<never> => err({ kind: 'schema', path, reason });

const isPlainObject = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const describeType = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

const codePointLength = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/** Rejects keys outside `allowed`, reporting the first one in UTF-16 order for determinism. */
function checkNoExtraKeys(obj: Obj, allowed: readonly string[], prefix: string, what: string): Check<void> {
  const extra = Object.keys(obj)
    .filter((k) => !allowed.includes(k))
    .sort();
  if (extra.length > 0) {
    const key = extra[0]!;
    return fail(prefix ? `${prefix}.${key}` : key, `unknown ${what} "${key}"`);
  }
  return ok(undefined);
}

function checkText(root: Obj, field: 'displayName' | 'description', max: number): Check<string> {
  if (!Object.hasOwn(root, field)) return fail(field, 'missing required field');
  const v = root[field];
  if (typeof v !== 'string') return fail(field, `expected string, got ${describeType(v)}`);
  const len = codePointLength(v);
  if (len < 1 || len > max) {
    return fail(field, `length ${len} is outside 1 to ${max} characters`);
  }
  return ok(v);
}

function checkParam(spec: ParamSpec, params: Obj, path: string): Check<ParamValue | undefined> {
  if (!Object.hasOwn(params, spec.name)) {
    return spec.required ? fail(path, 'missing required parameter') : ok(undefined);
  }
  const v = params[spec.name];
  switch (spec.type) {
    case 'number':
    case 'integer': {
      if (typeof v !== 'number') return fail(path, `expected ${spec.type}, got ${describeType(v)}`);
      if (!Number.isFinite(v)) return fail(path, `value ${String(v)} is not finite`);
      if (spec.type === 'integer' && !Number.isInteger(v)) {
        return fail(path, `expected integer, got ${v}`);
      }
      if (v < spec.min || v > spec.max) {
        return fail(path, `value ${v} is outside the range ${spec.min} to ${spec.max}`);
      }
      return ok(Object.is(v, -0) ? 0 : v);
    }
    case 'enum':
      if (typeof v !== 'string') return fail(path, `expected string, got ${describeType(v)}`);
      if (!spec.values.includes(v)) {
        return fail(path, `value "${v}" is not one of ${spec.values.map((x) => `"${x}"`).join(', ')}`);
      }
      return ok(v);
    case 'boolean':
      if (typeof v !== 'boolean') return fail(path, `expected boolean, got ${describeType(v)}`);
      return ok(v);
  }
}

function checkInvocation(v: unknown, index: number, registry: RegistryView): Check<PrimitiveInvocation> {
  const at = `primitives[${index}]`;
  if (!isPlainObject(v)) return fail(at, `expected object, got ${describeType(v)}`);
  if (!Object.hasOwn(v, 'primitive')) return fail(`${at}.primitive`, 'missing required field');
  const name = v.primitive;
  if (typeof name !== 'string') return fail(`${at}.primitive`, `expected string, got ${describeType(name)}`);
  const descriptor = registry.get(name);
  if (!descriptor) return fail(`${at}.primitive`, `unknown Move_Primitive "${name}"`);

  if (!Object.hasOwn(v, 'params')) return fail(`${at}.params`, 'missing required field');
  const rawParams = v.params;
  if (!isPlainObject(rawParams)) return fail(`${at}.params`, `expected object, got ${describeType(rawParams)}`);

  const params: Record<string, ParamValue> = {};
  for (const spec of descriptor.paramSchema) {
    const r = checkParam(spec, rawParams, `${at}.params.${spec.name}`);
    if (!r.ok) return r;
    if (r.value !== undefined) params[spec.name] = r.value;
  }
  const extraParams = checkNoExtraKeys(
    rawParams,
    descriptor.paramSchema.map((p) => p.name),
    `${at}.params`,
    `parameter for "${name}"`,
  );
  if (!extraParams.ok) return extraParams;
  const extra = checkNoExtraKeys(v, ['primitive', 'params'], at, 'field');
  if (!extra.ok) return extra;
  return ok({ primitive: name, params });
}

function checkTargets(root: Obj): Check<TargetRules> {
  if (!Object.hasOwn(root, 'targets')) return fail('targets', 'missing required field');
  const t = root.targets;
  if (!isPlainObject(t)) return fail('targets', `expected object, got ${describeType(t)}`);
  const pick = <V extends string>(field: 'primary' | 'affects', values: readonly V[]): Check<V> => {
    const path = `targets.${field}`;
    if (!Object.hasOwn(t, field)) return fail(path, 'missing required field');
    const v = t[field];
    if (typeof v !== 'string') return fail(path, `expected string, got ${describeType(v)}`);
    if (!(values as readonly string[]).includes(v)) {
      return fail(path, `value "${v}" is not one of ${values.map((x) => `"${x}"`).join(', ')}`);
    }
    return ok(v as V);
  };
  const primary = pick('primary', TARGET_PRIMARY_VALUES);
  if (!primary.ok) return primary;
  const affects = pick('affects', TARGET_AFFECTS_VALUES);
  if (!affects.ok) return affects;
  const extra = checkNoExtraKeys(t, ['primary', 'affects'], 'targets', 'field');
  if (!extra.ok) return extra;
  return ok({ primary: primary.value, affects: affects.value });
}

const TOP_LEVEL_FIELDS = ['schemaVersion', 'displayName', 'description', 'primitives', 'targets'] as const;

/**
 * Checks an arbitrary value against the Move_Block_Schema and returns a freshly built
 * MoveBlock (with `-0` normalized to `0`) or the first nonconformance.
 */
export function validateMoveBlockValue(value: unknown, registry: RegistryView): Check<MoveBlock> {
  if (!isPlainObject(value)) return fail('', `expected object, got ${describeType(value)}`);

  if (!Object.hasOwn(value, 'schemaVersion')) return fail('schemaVersion', 'missing required field');
  const version = value.schemaVersion;
  if (typeof version !== 'number') {
    return fail('schemaVersion', `expected number, got ${describeType(version)}`);
  }
  if (version !== MOVE_BLOCK_SCHEMA_VERSION) {
    return fail('schemaVersion', `unsupported schema version ${String(version)}`);
  }

  const displayName = checkText(value, 'displayName', DISPLAY_NAME_MAX);
  if (!displayName.ok) return displayName;
  const description = checkText(value, 'description', DESCRIPTION_MAX);
  if (!description.ok) return description;

  if (!Object.hasOwn(value, 'primitives')) return fail('primitives', 'missing required field');
  const list = value.primitives;
  if (!Array.isArray(list)) return fail('primitives', `expected array, got ${describeType(list)}`);
  if (list.length < PRIMITIVES_MIN || list.length > PRIMITIVES_MAX) {
    return fail(
      'primitives',
      `has ${list.length} invocations; expected ${PRIMITIVES_MIN} to ${PRIMITIVES_MAX}`,
    );
  }
  const primitives: PrimitiveInvocation[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = checkInvocation(list[i], i, registry);
    if (!r.ok) return r;
    primitives.push(r.value);
  }

  const targets = checkTargets(value);
  if (!targets.ok) return targets;

  const extra = checkNoExtraKeys(value, TOP_LEVEL_FIELDS, '', 'field');
  if (!extra.ok) return extra;

  return ok({
    schemaVersion: MOVE_BLOCK_SCHEMA_VERSION,
    displayName: displayName.value,
    description: description.value,
    primitives,
    targets: targets.value,
  });
}
