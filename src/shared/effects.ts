// Effects are parametric: where every arrow, bolt, beam or wave is at a given age is a pure function
// of how the effect was cast. The simulation uses these functions for hits and the renderer uses the
// same ones to draw, so what a player sees is exactly what was scored, at any frame rate.
import { ARENA_HALF, EFFECT_SECONDS } from './balance';
import type { MoveSpec } from './types';
import { clamp, hash01 } from './util';

export interface EffectState {
  id: number;
  owner: 0 | 1;
  move: MoveSpec;
  /** Simulation time at which it was cast. */
  t0: number;
  /** Caster's hand at the cast. */
  ox: number;
  oy: number;
  /** Caster's centre at the cast. */
  cx: number;
  /** Where the opponent was at the cast. */
  tx: number;
  ty: number;
  dir: 1 | -1;
  seed: number;
  /** Per projectile: 0 in flight, 1 hit, 2 blocked. */
  used: number[];
  /** Single-hit deliveries (melee, wave, burst) have landed or missed. */
  done: boolean;
  /** Beam ticks already applied. */
  ticks: number;
  /** A lingering move has already afflicted its target. */
  afflicted: boolean;
  /** Came from a typed prompt rather than a built-in move. */
  prompt: boolean;
}

export const BEAM = { start: 0.2, end: 1.5, half: 0.3, ticks: 8, firstTick: 0.3, tickEvery: 0.15, speed: 42 } as const;
export const WAVE = { start: 0.15, speed: 10, half: 0.45, height: 1.0 } as const;
export const BURST = { start: 0.18, grow: 0.32, radius: 3.1, fade: 0.9 } as const;
export const MELEE = { active: 0.16, life: 0.42, height: 2.8 } as const;
export const RAIN = { warn: 0.5, spread: 0.95, top: 9 } as const;
export const PROJECTILE_RADIUS = 0.24;

const HEAVY = new Set(['hammer', 'rock', 'skull', 'fist', 'orb', 'lotus']);

export interface ProjectilePose {
  x: number;
  y: number;
  /** Direction of travel in radians, y up. */
  angle: number;
  /** In the air right now. */
  live: boolean;
  /** Seconds since this one launched (negative before launch). */
  flight: number;
}

/** Half width of the ground zone a rain covers. */
export function rainHalfWidth(count: number): number {
  return 0.8 + 0.25 * Math.sqrt(Math.max(1, count));
}

/** Where a rain strike lands and when, relative to the cast. */
export function rainStrike(e: EffectState, i: number): { x: number; at: number } {
  const n = Math.max(1, e.move.count);
  const w = rainHalfWidth(n);
  const x = clamp(e.tx + ((i + hash01(e.seed, i)) / n - 0.5) * 2 * w, -ARENA_HALF, ARENA_HALF);
  const at = RAIN.warn + hash01(e.seed, i + 101) * RAIN.spread;
  return { x, at };
}

export function projectileSpeed(move: MoveSpec): number {
  if (move.delivery === 'rain') return move.shape === 'bolt' ? 70 : 24;
  return HEAVY.has(move.shape) ? 15 : 19;
}

/** Position of projectile `i` at `age` seconds after the cast, for projectile and rain deliveries. */
export function projectileAt(e: EffectState, i: number, age: number): ProjectilePose {
  const n = Math.max(1, e.move.count);
  const speed = projectileSpeed(e.move);
  if (e.move.delivery === 'rain') {
    const s = rainStrike(e, i);
    const fall = RAIN.top / speed;
    const flight = age - (s.at - fall);
    const h = RAIN.top - speed * flight;
    const slant = e.move.shape === 'bolt' ? 0 : 0.22;
    return { x: s.x - e.dir * slant * h, y: h, angle: Math.atan2(-1, e.dir * slant), live: flight >= 0 && h > 0, flight };
  }
  const stagger = n > 1 ? Math.min(0.11, 0.85 / (n - 1)) : 0;
  const flight = age - i * stagger;
  const dx = Math.max(1.5, Math.abs(e.tx - e.ox));
  const spread = n > 1 ? (hash01(e.seed, i) - 0.5) * Math.min(1.3, 0.5 + n * 0.06) : 0;
  const aimY = clamp(e.ty + spread, 0.45, 2.7);
  const a = clamp(Math.atan2(aimY - e.oy, dx), -0.6, 0.6);
  const d = speed * flight;
  const x = e.ox + e.dir * Math.cos(a) * d;
  const y = e.oy + Math.sin(a) * d;
  const live = flight >= 0 && y > 0 && Math.abs(x) < ARENA_HALF + 1.2 && age < EFFECT_SECONDS;
  return { x, y, angle: e.dir === 1 ? a : Math.PI - a, live, flight };
}

export interface BeamSpan {
  active: boolean;
  x0: number;
  x1: number;
  y: number;
  half: number;
  /** 0..1 strength for drawing: fades in and out at the ends. */
  strength: number;
}

export function beamSpan(e: EffectState, age: number): BeamSpan {
  const active = age >= BEAM.start && age <= BEAM.end;
  const len = clamp((age - BEAM.start) * BEAM.speed, 0, ARENA_HALF * 2 + 2);
  const fadeIn = clamp((age - BEAM.start) / 0.12, 0, 1);
  const fadeOut = clamp((BEAM.end - age) / 0.2, 0, 1);
  return { active, x0: e.ox, x1: e.ox + e.dir * len, y: e.oy, half: BEAM.half, strength: active ? Math.min(fadeIn, fadeOut) : 0 };
}

export function waveX(e: EffectState, age: number): { active: boolean; x: number } {
  const x = e.cx + e.dir * (0.6 + Math.max(0, age - WAVE.start) * WAVE.speed);
  return { active: age >= WAVE.start && Math.abs(x) < ARENA_HALF + 1, x };
}

export function burstRadius(e: EffectState, age: number): { active: boolean; r: number; strength: number } {
  const g = clamp((age - BURST.start) / BURST.grow, 0, 1);
  const active = age >= BURST.start && age <= BURST.start + BURST.grow;
  const strength = age < BURST.start ? 0 : clamp(1 - (age - BURST.start - BURST.grow) / (BURST.fade - BURST.grow), 0, 1);
  return { active, r: BURST.radius * (1 - (1 - g) * (1 - g)), strength };
}

export function meleeReach(move: MoveSpec): number {
  return clamp(move.reach ?? 1.8, 1.2, 3);
}

/** Seconds an effect stays in the world. Nothing lasts longer than the two-second rule. */
export function effectLife(move: MoveSpec): number {
  if (move.kind === 'defense') return EFFECT_SECONDS;
  if (move.delivery === 'melee') return MELEE.life;
  if (move.delivery === 'burst') return 1.0;
  return EFFECT_SECONDS;
}
