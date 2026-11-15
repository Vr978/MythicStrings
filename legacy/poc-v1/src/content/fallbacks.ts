// Hand-authored Fallback_Moves (Req 17.1). Each uses only registered primitives with
// in-range parameters; content tests check them against the default registry.
import type { MoveBlock } from '../core/moveblock/types';

const opponent = { primary: 'selected_opponent', affects: 'primary_only' } as const;

export const FALLBACK_MOVES: readonly MoveBlock[] = Object.freeze([
  {
    schemaVersion: 1,
    displayName: 'Staff Strike',
    description: 'A quick bamboo staff blow to the torso.',
    primitives: [{ primitive: 'apply_impulse', params: { segment: 'torso', magnitude: 900, angleDeg: 0 } }],
    targets: opponent,
  },
  {
    schemaVersion: 1,
    displayName: 'Lamp-Shadow Lunge',
    description: 'A shadow double leaps from the lamplight and charges.',
    primitives: [
      { primitive: 'spawn_clones', params: { count: 1, source: 'shadow', lifetimeMs: 1500, behavior: 'charge' } },
    ],
    targets: opponent,
  },
  {
    schemaVersion: 1,
    displayName: 'Leather Shield Bash',
    description: 'A hard shove with a painted leather shield.',
    primitives: [
      { primitive: 'apply_impulse', params: { segment: 'torso', magnitude: 1200, angleDeg: 10 } },
      { primitive: 'apply_impulse', params: { segment: 'head', magnitude: 300, angleDeg: 20 } },
    ],
    targets: opponent,
  },
  {
    schemaVersion: 1,
    displayName: 'Pebble Toss',
    description: 'A handful of pebbles flung in a low arc.',
    primitives: [
      {
        primitive: 'projectile_volley',
        params: { count: 5, projectileShape: 'stone', speed: 14, spreadDeg: 15, intervalMs: 60 },
      },
    ],
    targets: opponent,
  },
  {
    schemaVersion: 1,
    displayName: 'Rolling Wheel',
    description: 'A loose chariot wheel drops and rolls toward the foe.',
    primitives: [{ primitive: 'summon_object', params: { object: 'chariot_wheel', sizeScale: 0.8, dropHeight: 2 } }],
    targets: opponent,
  },
  {
    schemaVersion: 1,
    displayName: 'Low Sweep',
    description: 'A sweeping kick aimed at the shins.',
    primitives: [{ primitive: 'apply_impulse', params: { segment: 'shin', magnitude: 700, angleDeg: 160 } }],
    targets: opponent,
  },
]);
