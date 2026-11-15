// Back-lit Stage (Req 1.3): a warm radial "oil lamp" gradient on the bottom layer with a slight
// seeded flicker, Kurukshetra backdrop silhouettes from the Stage palette, and the floor line.
import { Application, Container, FillGradient, Graphics } from 'pixi.js';
import type { StageSpec, Vec2 } from '../core/scenario/types';
import { flickerAt } from './flicker';
import { createStageLayout, fitViewport, worldToStagePx, type StageLayout } from './layout';
import { mixColor, parseHexColor, PUPPET_BLEND_MODE, shadeColor } from './style';

export interface StageLayers {
  /** Full-screen backlight, outside the letterboxed viewport. */
  backlight: Graphics;
  /** Letterboxed container in Stage pixels; everything below lives in it. */
  viewport: Container;
  backdrop: Container;
  puppets: Container;
  effects: Container;
  /** Top layer for joint rivets (Req 1.2). */
  pivots: Container;
}

export interface StageView {
  readonly app: Application | null;
  readonly layout: StageLayout;
  readonly layers: StageLayers;
  readonly seed: number;
  /** Re-fits the viewport and backlight to a screen size in CSS pixels. */
  resize(width: number, height: number): void;
  /** Applies the backlight flicker for a time in milliseconds. */
  setTime(tMs: number): void;
  destroy(): void;
}

const LAMP_CORE = 0xfff1c8;
const DEFAULT_PALETTE = ['#f6c56b', '#e38b3c', '#b2512f', '#5a2a3c', '#2a1a33'];

function paletteColors(stage: StageSpec): number[] {
  const src = stage.backdropPalette.length > 0 ? stage.backdropPalette : DEFAULT_PALETTE;
  const colors = src.map((c, i) => parseHexColor(c, parseHexColor(DEFAULT_PALETTE[i % DEFAULT_PALETTE.length], 0xe38b3c)));
  while (colors.length < 4) colors.push(shadeColor(colors[colors.length - 1]!, 0.6));
  return colors;
}

function toFlat(layout: StageLayout, pts: Vec2[]): number[] {
  const out: number[] = [];
  for (const p of pts) {
    const s = worldToStagePx(layout, p);
    out.push(s.x, s.y);
  }
  return out;
}

function circlePts(cx: number, cy: number, r: number, n = 24): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}

/** Redraws the backlight gradient to cover a screen of the given size. */
function drawBacklight(g: Graphics, palette: number[], width: number, height: number): void {
  const gradient = new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.55 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.55 },
    outerRadius: 0.75,
    colorStops: [
      { offset: 0, color: LAMP_CORE },
      { offset: 0.3, color: palette[0]! },
      { offset: 0.65, color: palette[1]! },
      { offset: 1, color: mixColor(palette[1]!, palette[2]!, 0.7) },
    ],
    textureSpace: 'local',
  });
  g.clear().rect(0, 0, Math.max(1, width), Math.max(1, height)).fill(gradient);
}

/** Distant hills, chariots, and banners of Kurukshetra as translucent multiply silhouettes. */
function drawBackdrop(layer: Container, stage: StageSpec, layout: StageLayout, palette: number[]): void {
  const far = palette[2]!;
  const near = palette[3]!;
  const ground = palette[palette.length - 1]!;
  const { xMin, xMax, floorY, yMin } = layout;
  const width = xMax - xMin;

  const hills = new Graphics();
  const ridge: Vec2[] = [{ x: xMin, y: floorY }];
  for (let i = 0; i <= 32; i++) {
    const x = xMin + (width * i) / 32;
    const y = floorY + 0.9 + 0.45 * Math.sin(i * 0.7) + 0.25 * Math.sin(i * 1.9 + 1);
    ridge.push({ x, y });
  }
  ridge.push({ x: xMax, y: floorY });
  hills.poly(toFlat(layout, ridge)).fill({ color: far, alpha: 0.3 });
  hills.blendMode = PUPPET_BLEND_MODE;

  const chariots = new Graphics();
  const wheels: Graphics[] = [];
  const chariot = (cx: number, dir: 1 | -1) => {
    const wheelR = 0.55;
    const wy = floorY + wheelR;
    // Car body and yoke pole.
    chariots
      .poly(toFlat(layout, [
        { x: cx - 0.9 * dir, y: wy - 0.05 },
        { x: cx + 0.7 * dir, y: wy - 0.05 },
        { x: cx + 0.55 * dir, y: wy + 0.75 },
        { x: cx - 0.8 * dir, y: wy + 0.55 },
      ]))
      .fill({ color: near, alpha: 0.45 });
    chariots
      .poly(toFlat(layout, [
        { x: cx + 0.7 * dir, y: wy + 0.05 },
        { x: cx + 2.0 * dir, y: wy + 0.25 },
        { x: cx + 2.0 * dir, y: wy + 0.31 },
        { x: cx + 0.7 * dir, y: wy + 0.13 },
      ]))
      .fill({ color: near, alpha: 0.45 });
    // Spoked wheel: rim disc with the gaps between spokes cut out. It gets its own Graphics because
    // `cut()` also applies to the previous fill instruction in the same context.
    const wheel = new Graphics();
    wheel.poly(toFlat(layout, circlePts(cx, wy, wheelR))).fill({ color: near, alpha: 0.5 });
    for (let s = 0; s < 8; s++) {
      const a0 = (s / 8) * Math.PI * 2 + 0.12;
      const a1 = ((s + 1) / 8) * Math.PI * 2 - 0.12;
      const gap: Vec2[] = [{ x: cx + Math.cos((a0 + a1) / 2) * 0.12, y: wy + Math.sin((a0 + a1) / 2) * 0.12 }];
      for (let k = 0; k <= 4; k++) {
        const a = a0 + ((a1 - a0) * k) / 4;
        gap.push({ x: cx + Math.cos(a) * wheelR * 0.82, y: wy + Math.sin(a) * wheelR * 0.82 });
      }
      wheel.poly(toFlat(layout, gap)).cut();
    }
    wheel.blendMode = PUPPET_BLEND_MODE;
    wheels.push(wheel);
    // Banner pole with a pennant.
    const px = cx - 0.6 * dir;
    chariots
      .poly(toFlat(layout, [
        { x: px - 0.03, y: wy + 0.5 },
        { x: px + 0.03, y: wy + 0.5 },
        { x: px + 0.03, y: wy + 2.4 },
        { x: px - 0.03, y: wy + 2.4 },
      ]))
      .fill({ color: near, alpha: 0.5 });
    chariots
      .poly(toFlat(layout, [
        { x: px, y: wy + 2.4 },
        { x: px + 0.8 * dir, y: wy + 2.15 },
        { x: px, y: wy + 1.9 },
      ]))
      .fill({ color: near, alpha: 0.4 });
  };
  chariot(xMin + width * 0.12, 1);
  chariot(xMax - width * 0.12, -1);
  chariots.blendMode = PUPPET_BLEND_MODE;

  const props = new Graphics();
  for (const prop of stage.props) {
    if (prop.outline.length < 3) continue;
    const pts = prop.outline.map((p) => ({ x: prop.position.x + p.x, y: prop.position.y + p.y }));
    props.poly(toFlat(layout, pts)).fill({ color: parseHexColor(prop.color, near), alpha: 0.75 });
  }
  props.blendMode = PUPPET_BLEND_MODE;

  // Floor band below the floor line, then the line itself.
  const floor = new Graphics();
  floor
    .poly(toFlat(layout, [
      { x: xMin, y: floorY },
      { x: xMax, y: floorY },
      { x: xMax, y: yMin },
      { x: xMin, y: yMin },
    ]))
    .fill({ color: ground, alpha: 0.55 });
  const a = worldToStagePx(layout, { x: xMin, y: floorY });
  const b = worldToStagePx(layout, { x: xMax, y: floorY });
  floor.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: shadeColor(ground, 0.7), width: 3, alpha: 0.9 });
  floor.blendMode = PUPPET_BLEND_MODE;

  layer.addChild(hills, chariots, ...wheels, props, floor);
}

/**
 * Builds the Stage scene graph without creating a renderer. `createStage` wraps this with a
 * PixiJS `Application`; tests can use it directly.
 */
export function buildStageScene(stage: StageSpec, seed: number): { root: Container; view: StageView } {
  const layout = createStageLayout(stage);
  const palette = paletteColors(stage);
  const root = new Container();
  const backlight = new Graphics();
  const viewport = new Container();
  const backdrop = new Container();
  const puppets = new Container();
  const effects = new Container();
  const pivots = new Container();
  viewport.addChild(backdrop, puppets, effects, pivots);
  root.addChild(backlight, viewport);
  drawBackdrop(backdrop, stage, layout, palette);

  let size = { w: -1, h: -1 };
  const view: StageView = {
    app: null,
    layout,
    layers: { backlight, viewport, backdrop, puppets, effects, pivots },
    seed,
    resize(width, height) {
      if (width === size.w && height === size.h) return;
      size = { w: width, h: height };
      drawBacklight(backlight, palette, width, height);
      const fit = fitViewport(layout, width, height);
      viewport.scale.set(fit.scale);
      viewport.position.set(fit.x, fit.y);
    },
    setTime(tMs) {
      const f = flickerAt(seed, tMs);
      backlight.tint = mixColor(0x000000, 0xffffff, f);
    },
    destroy() {
      root.destroy({ children: true });
    },
  };
  return { root, view };
}

/** Creates the PixiJS v8 Application inside `container` and draws the back-lit Stage. */
export async function createStage(container: HTMLElement, stage: StageSpec, seed: number): Promise<StageView> {
  const app = new Application();
  await app.init({
    resizeTo: container,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, globalThis.devicePixelRatio || 1),
    background: 0x120a08,
  });
  container.appendChild(app.canvas);
  const { root, view: scene } = buildStageScene(stage, seed);
  app.stage.addChild(root);

  const start = performance.now();
  const tick = () => {
    scene.resize(app.screen.width, app.screen.height);
    scene.setTime(performance.now() - start);
  };
  tick();
  app.ticker.add(tick);

  let destroyed = false;
  return {
    ...scene,
    app,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      app.ticker.remove(tick);
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
