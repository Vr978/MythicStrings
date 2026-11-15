// Every tunable number in the game lives here: arena, timing, costs, damage, progression.
import { STAT_KEYS, type CharacterSheet, type Stats } from './types';
import { clamp } from './util';

// --- Arena and bodies (metres, y up, floor at 0) -------------------------------------------------
export const ARENA_HALF = 7.4;
export const FIGHTER_HALF_W = 0.42;
export const FIGHTER_H = 2.6;
export const CROUCH_H = 1.3;
export const HAND_Y = 1.72;
export const MIN_GAP = 0.9;

export const WALK_SPEED = 5.2;
export const JUMP_SPEED = 11.5;
export const GRAVITY = 30;

// --- Match ---------------------------------------------------------------------------------------
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const MATCH_SECONDS = 120;
export const INTRO_SECONDS = 3;
/** Nothing an attack or a shield puts on screen outlives this. */
export const EFFECT_SECONDS = 2;

// --- Stamina: pays for the two built-in moves -----------------------------------------------------
export const STAMINA_MAX = 100;
export const STAMINA_REGEN = 9;
export const STAMINA_DELAY = 0.35;

// --- Mantra: pays for typed prompts ---------------------------------------------------------------
export const MANTRA_MAX = 100;
export const MANTRA_REGEN = 5.5;
/** Real seconds a player has to type while time is slowed. */
export const PROMPT_SECONDS = 5;
/** Longest the world waits for the AI before the fallback resolver answers. */
export const RESOLVE_SECONDS = 3.5;
export const SLOWMO_SCALE = 0.12;
/** Opening the prompt and submitting nothing still costs this, so slow motion cannot be spammed. */
export const EMPTY_PROMPT_COST = 16;
export const PROMPT_MAX_CHARS = 80;

// --- Prompt damage and cost -----------------------------------------------------------------------
/** Total damage by magnitude 1..5, before clarity and the caster's multiplier. */
export const PROMPT_DAMAGE = [5, 8, 11, 14, 18] as const;
export const SHIELD_COST = { wall: 34, canopy: 30, dome: 52 } as const;

export function promptAttackCost(magnitude: number, chars: number, typedMs: number): number {
  const lengthFee = Math.min(12, Math.floor(chars / 7));
  const timeFee = Math.min(8, Math.floor(typedMs / 700));
  return clamp(Math.round(16 + 13 * magnitude + lengthFee + timeFee), 30, MANTRA_MAX);
}

export function promptShieldCost(form: keyof typeof SHIELD_COST, chars: number, typedMs: number): number {
  const lengthFee = Math.min(10, Math.floor(chars / 8));
  const timeFee = Math.min(6, Math.floor(typedMs / 900));
  return clamp(SHIELD_COST[form] + lengthFee + timeFee, 26, MANTRA_MAX);
}

export function promptDamage(magnitude: number, clarity: number): number {
  const base = PROMPT_DAMAGE[clamp(Math.round(magnitude), 1, 5) - 1]!;
  return Math.round(base * (0.55 + 0.45 * clamp(clarity, 0, 1)) * 10) / 10;
}

// --- Lingering damage -----------------------------------------------------------------------------
/** Shares of the total dealt on each tick. They sum to 1, so lingering never out-damages instant. */
export const LINGER_SHARES = [0.5, 0.25, 0.25] as const;
export const LINGER_INTERVAL = 2;

// --- Ratings --------------------------------------------------------------------------------------
const STAT_WEIGHTS: Stats = { strength: 1, skill: 1, speed: 0.9, endurance: 1, power: 1.1, wisdom: 0.8 };

/** The single 0..100 number a legend is known by. It is also the HP the legend starts with. */
export function ratingFromStats(stats: Stats): number {
  let sum = 0;
  let weight = 0;
  for (const k of STAT_KEYS) {
    sum += clamp(stats[k], 0, 100) * STAT_WEIGHTS[k];
    weight += STAT_WEIGHTS[k];
  }
  return clamp(Math.round(sum / weight), 40, 99);
}

// --- Progression (custom characters only) ---------------------------------------------------------
export const CUSTOM_BASE_RATING = 60;
export const MAX_LEVEL = 10;
export const WINS_PER_LEVEL = 3;
export const RANKS = ['Novice', 'Apprentice', 'Warrior', 'Champion', 'Hero', 'Legend', 'Demigod', 'Titan', 'Deity', 'Mythic'] as const;

export function levelForWins(wins: number): number {
  return clamp(1 + Math.floor(Math.max(0, wins) / WINS_PER_LEVEL), 1, MAX_LEVEL);
}

export function ratingForLevel(level: number): number {
  const l = clamp(Math.round(level), 1, MAX_LEVEL);
  return Math.round(CUSTOM_BASE_RATING + ((100 - CUSTOM_BASE_RATING) * (l - 1)) / (MAX_LEVEL - 1));
}

export function rankName(level: number): string {
  return RANKS[clamp(Math.round(level), 1, MAX_LEVEL) - 1]!;
}

/** Wins still needed for the next rank, or 0 at the top. */
export function winsToNextLevel(wins: number): number {
  const level = levelForWins(wins);
  return level >= MAX_LEVEL ? 0 : level * WINS_PER_LEVEL - wins;
}

/** Custom characters share one even stat line that rises with their level. */
export function customStats(level: number): Stats {
  const v = ratingForLevel(level);
  return { strength: v, skill: v, speed: v, endurance: v, power: v, wisdom: v };
}

// --- What the six criteria do in a fight ----------------------------------------------------------
const scale = (stat: number, spread: number): number => 1 - spread / 2 + (spread * clamp(stat, 0, 100)) / 100;

export interface Derived {
  maxHp: number;
  moveSpeed: number;
  staminaRegen: number;
  mantraRegen: number;
  baseDamage: number;
  specialDamage: number;
  promptDamage: number;
  cooldown: number;
}

export function derive(sheet: Pick<CharacterSheet, 'stats' | 'rating'>): Derived {
  const s = sheet.stats;
  const tier = 0.85 + (0.3 * clamp(sheet.rating, 0, 100)) / 100;
  return {
    maxHp: clamp(Math.round(sheet.rating), 1, 100),
    moveSpeed: WALK_SPEED * scale(s.speed, 0.3),
    staminaRegen: STAMINA_REGEN * scale(s.endurance, 0.3),
    mantraRegen: MANTRA_REGEN * scale(s.wisdom, 0.3),
    baseDamage: tier * scale((s.strength + s.skill) / 2, 0.2),
    specialDamage: tier * scale(s.power, 0.2),
    promptDamage: tier * scale(s.wisdom, 0.1),
    cooldown: scale(100 - s.skill, 0.2),
  };
}
