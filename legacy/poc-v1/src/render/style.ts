// Pure style helpers shared by puppets and effects (Req 1.1, 1.6).

export const ALPHA_MIN = 0.3;
export const ALPHA_MAX = 0.9;
export const DEFAULT_ALPHA = 0.7;
/** Translucent leather blends multiplicatively with the backlight, so overlaps darken (Req 1.3). */
export const PUPPET_BLEND_MODE = 'multiply' as const;

/** Clamps an opacity to [0.3, 0.9]. Non-finite values use the default. */
export function clampAlpha(alpha: number | undefined): number {
  if (alpha === undefined || !Number.isFinite(alpha)) return DEFAULT_ALPHA;
  return Math.min(ALPHA_MAX, Math.max(ALPHA_MIN, alpha));
}

/** Parses `#rgb` or `#rrggbb` to a 24-bit integer; returns `fallback` for anything else. */
export function parseHexColor(value: string | undefined, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return fallback;
  let hex = m[1]!;
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return parseInt(hex, 16);
}

/** Linear blend of two 24-bit colors, t in [0, 1]. */
export function mixColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (shift: number) => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * k) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}

/** Multiplies each channel by `f` (0..1 darkens). */
export function shadeColor(c: number, f: number): number {
  return mixColor(0x000000, c, f);
}

export type Rgb = readonly [number, number, number];

/**
 * Per-channel result (0..1) of drawing `color` with `alpha` over `dst` using the PixiJS v8 WebGL
 * 'multiply' blend (DST_COLOR, ONE_MINUS_SRC_ALPHA) with premultiplied source: dst * (c·a + 1 − a).
 */
export function multiplyOver(dst: Rgb, color: Rgb, alpha: number): Rgb {
  return [
    dst[0] * (color[0] * alpha + 1 - alpha),
    dst[1] * (color[1] * alpha + 1 - alpha),
    dst[2] * (color[2] * alpha + 1 - alpha),
  ];
}

/** Relative luminance weights (Rec. 709) on linear-ish channels; enough for ordering comparisons. */
export function luminance(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function hexToRgb(c: number): Rgb {
  return [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255];
}
