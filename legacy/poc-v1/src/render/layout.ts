// Pure mapping between sim space (meters, y-up, Stage centred on x = 0) and Stage pixels
// (y-down, origin at the top-left of the visible Stage). No PixiJS or DOM imports, so it runs in Node.
import type { StageSpec, Vec2 } from '../core/scenario/types';

/** Logical pixels per meter. The viewport container scales the whole Stage to fit the screen. */
export const PX_PER_M = 100;
/** Fraction of the Stage height shown below the floor line. */
export const FLOOR_MARGIN_FRACTION = 0.1;

export interface StageLayout {
  /** Visible world bounds in meters. */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  floorY: number;
  ppm: number;
  /** Size of the visible Stage in logical pixels. */
  widthPx: number;
  heightPx: number;
}

export function createStageLayout(stage: Pick<StageSpec, 'width' | 'height' | 'floorY'>, ppm = PX_PER_M): StageLayout {
  const width = stage.width > 0 && Number.isFinite(stage.width) ? stage.width : 16;
  const height = stage.height > 0 && Number.isFinite(stage.height) ? stage.height : 9;
  const floorY = Number.isFinite(stage.floorY) ? stage.floorY : 0;
  const yMin = floorY - height * FLOOR_MARGIN_FRACTION;
  return {
    xMin: -width / 2,
    xMax: width / 2,
    yMin,
    yMax: yMin + height,
    floorY,
    ppm,
    widthPx: width * ppm,
    heightPx: height * ppm,
  };
}

/** World point (meters, y-up) to Stage pixels (y-down). */
export function worldToStagePx(layout: StageLayout, p: Vec2): Vec2 {
  return { x: (p.x - layout.xMin) * layout.ppm, y: (layout.yMax - p.y) * layout.ppm };
}

/** Inverse of `worldToStagePx`. */
export function stagePxToWorld(layout: StageLayout, p: Vec2): Vec2 {
  return { x: p.x / layout.ppm + layout.xMin, y: layout.yMax - p.y / layout.ppm };
}

/** Sim angles are counter-clockwise in y-up space; Pixi rotations are clockwise in y-down space. */
export function worldAngleToScreen(angle: number): number {
  return -angle;
}

/** Body-local offset (meters, y-up) to body-local pixels (y-down), before rotation. */
export function localToPx(p: Vec2, ppm = PX_PER_M): Vec2 {
  return { x: p.x * ppm, y: -p.y * ppm };
}

/** True when a Stage-pixel point lies inside the visible Stage rectangle (inclusive). */
export function isInsideStage(layout: StageLayout, p: Vec2): boolean {
  return p.x >= 0 && p.x <= layout.widthPx && p.y >= 0 && p.y <= layout.heightPx;
}

export interface ViewportFit {
  scale: number;
  x: number;
  y: number;
}

/** Letterboxes the Stage into a screen of the given size, centred. */
export function fitViewport(layout: StageLayout, screenW: number, screenH: number): ViewportFit {
  const sw = Math.max(1, screenW);
  const sh = Math.max(1, screenH);
  const scale = Math.min(sw / layout.widthPx, sh / layout.heightPx);
  return { scale, x: (sw - layout.widthPx * scale) / 2, y: (sh - layout.heightPx * scale) / 2 };
}

/** World position of a point fixed in a rotating body frame. */
export function bodyPointToWorld(body: { x: number; y: number; angle: number }, local: Vec2): Vec2 {
  const c = Math.cos(body.angle);
  const s = Math.sin(body.angle);
  return { x: body.x + local.x * c - local.y * s, y: body.y + local.x * s + local.y * c };
}
