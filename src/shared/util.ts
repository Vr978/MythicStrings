// Small pure helpers used on both sides of the wire.

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Integer hash to [0, 1). Deterministic, so both players and the server agree on every spread. */
export function hash01(seed: number, i: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((i + 1) | 0, 0x85ebca77)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** FNV-1a string hash, for seeding looks from a name. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Returns a normalised `#rrggbb`, or the fallback when the value is not a hex colour. */
export function hexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const m = HEX.exec(value.trim());
  if (!m) return fallback;
  let h = m[1]!.toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h}`;
}

export function hexToInt(value: string, fallback = 0x7a5a3a): number {
  const m = HEX.exec(value.trim());
  if (!m) return fallback;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return parseInt(h, 16);
}

export function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function num(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function str(value: unknown, fallback: string, max = 200): string {
  if (typeof value !== 'string') return fallback;
  const t = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length ? t.slice(0, max) : fallback;
}

export function uid(prefix = ''): string {
  const a = Math.random().toString(36).slice(2, 10);
  const b = Date.now().toString(36);
  return `${prefix}${b}${a}`;
}
