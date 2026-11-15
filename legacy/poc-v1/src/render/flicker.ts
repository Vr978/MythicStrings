// Seeded, smooth oil-lamp flicker for the Stage backlight. Pure, so two clients with the same
// Battle seed see the same flicker.

/** Maximum brightness drop. Kept small so the backlight stays "slight". */
export const FLICKER_AMPLITUDE = 0.06;
/** Spacing of the random control points in milliseconds. */
export const FLICKER_PERIOD_MS = 140;

function hash(seed: number, i: number): number {
  // Integer hash (lowbias32) of seed and index, mapped to [0, 1).
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i | 0, 0x85ebca77)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Brightness multiplier in [1 - FLICKER_AMPLITUDE, 1] at time `tMs`. */
export function flickerAt(seed: number, tMs: number): number {
  const t = Number.isFinite(tMs) ? Math.max(0, tMs) / FLICKER_PERIOD_MS : 0;
  const i = Math.floor(t);
  const f = t - i;
  const s = f * f * (3 - 2 * f); // smoothstep between control points
  const n = hash(seed, i) * (1 - s) + hash(seed, i + 1) * s;
  return 1 - FLICKER_AMPLITUDE * n;
}
