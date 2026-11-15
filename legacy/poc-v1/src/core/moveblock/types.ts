// Move_Block data model and Move_Primitive parameter schemas (design: "Move_Block (schemaVersion 1)").
// Pure types only: nothing here depends on Rapier, so parsing and printing run anywhere.

/** Success or failure without exceptions. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** The only Move_Block schema version this build understands (Req 12.1). */
export const MOVE_BLOCK_SCHEMA_VERSION = 1;

/** A Move_Block: a composable list of registered primitive invocations (Req 12.1). */
export interface MoveBlock {
  schemaVersion: typeof MOVE_BLOCK_SCHEMA_VERSION;
  /** 1..40 Unicode code points. */
  displayName: string;
  /** 1..280 Unicode code points. */
  description: string;
  /** Ordered, 1..10 invocations. */
  primitives: PrimitiveInvocation[];
  targets: TargetRules;
}

export type ParamValue = number | string | boolean;

export interface PrimitiveInvocation {
  /** Name of a registered Move_Primitive. */
  primitive: string;
  params: Record<string, ParamValue>;
}

export const TARGET_PRIMARY_VALUES = [
  'selected_opponent',
  'nearest_opponent',
  'weakest_opponent',
  'self',
] as const;
export const TARGET_AFFECTS_VALUES = ['primary_only', 'all_opponents', 'everyone'] as const;

export interface TargetRules {
  primary: (typeof TARGET_PRIMARY_VALUES)[number];
  affects: (typeof TARGET_AFFECTS_VALUES)[number];
}

export type ParamType = 'number' | 'integer' | 'enum' | 'boolean';

interface ParamSpecBase {
  name: string;
  required: boolean;
}

/** Finite double (`number`) or integer (`integer`) in the inclusive range [min, max]. */
export interface NumericParamSpec extends ParamSpecBase {
  type: 'number' | 'integer';
  min: number;
  max: number;
}

export interface EnumParamSpec extends ParamSpecBase {
  type: 'enum';
  values: readonly string[];
}

export interface BooleanParamSpec extends ParamSpecBase {
  type: 'boolean';
}

export type ParamSpec = NumericParamSpec | EnumParamSpec | BooleanParamSpec;

/**
 * Parameter schema of a Move_Primitive. The array order is the declared order,
 * which the parser uses to decide which nonconformance is reported first.
 */
export type ParamSchema = readonly ParamSpec[];

/** What the registry knows about a primitive; the sim layer adds `apply` on top. */
export interface PrimitiveDescriptor {
  /** Unique, snake_case. */
  name: string;
  version: number;
  paramSchema: ParamSchema;
}
