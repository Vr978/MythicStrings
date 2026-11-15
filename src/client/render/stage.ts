// The puppet theatre itself: a cloth screen lit from behind by an oil lamp, with a painted backdrop
// for each tradition, a floor band, and a festive border. Everything else is drawn onto its layers.
import { Application, Container, FillGradient, Graphics, TilingSprite, Texture } from 'pixi.js';
import type { StageTheme } from '../../shared/types';
import { hash01 } from '../../shared/util';
import { arc, mix } from './draw';

export const STAGE_W = 1600;
export const STAGE_H = 900;
/** Stage pixels per metre of the simulation. */
export const PPM = 100;
export const FLOOR_Y = 742;

/** Simulation metres to stage pixels. */
export const sx = (x: number): number => STAGE_W / 2 + x * PPM;
export const sy = (y: number): number => FLOOR_Y - y * PPM;

const FAR = 0xc47f3a;
const NEAR = 0x8a4420;

function weaveTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 96, 96);
  for (let i = 0; i < 96; i += 3) {
    const a = 0.03 + hash01(7, i) * 0.05;
    g.fillStyle = `rgba(90,50,20,${a.toFixed(3)})`;
    g.fillRect(0, i, 96, 1);
    g.fillStyle = `rgba(90,50,20,${(a * 0.8).toFixed(3)})`;
    g.fillRect(i, 0, 1, 96);
  }
  return Texture.from(c);
}

export class Stage {
  readonly app: Application;
  /** Letterboxed 1600 x 900 space that everything is drawn in. */
  readonly view = new Container();
  readonly layers = { backdrop: new Container(), puppets: new Container(), fx: new Container(), front: new Container() };
  private readonly light = new Graphics();
  private readonly weave: TilingSprite;
  private readonly flashG = new Graphics();
  private readonly slowG = new Graphics();
  private shakeAmt = 0;
  private flashAmt = 0;
  private slow = 0;
  private slowTarget = 0;
  private theme: StageTheme | null = null;
  private offX = 0;
  private offY = 0;
  private fit = 1;
  private lastW = 0;
  private lastH = 0;

  private constructor(app: Application) {
    this.app = app;
    const gradient = new FillGradient({
      type: 'radial',
      center: { x: 0.5, y: 0.56 },
      innerRadius: 0,
      outerCenter: { x: 0.5, y: 0.56 },
      outerRadius: 0.78,
      colorStops: [
        { offset: 0, color: 0xfff7dd },
        { offset: 0.42, color: 0xffe9b0 },
        { offset: 0.72, color: 0xf7bf62 },
        { offset: 0.9, color: 0xc7722c },
        { offset: 1, color: 0x6e3413 },
      ],
      textureSpace: 'local',
    });
    this.light.rect(0, 0, STAGE_W, STAGE_H).fill(gradient);
    this.weave = new TilingSprite({ texture: weaveTexture(), width: STAGE_W, height: STAGE_H });
    this.weave.blendMode = 'multiply';
    this.slowG.rect(0, 0, STAGE_W, STAGE_H).fill({ color: 0x1a2a6a, alpha: 1 });
    this.slowG.blendMode = 'multiply';
    this.slowG.alpha = 0;
    this.flashG.rect(0, 0, STAGE_W, STAGE_H).fill({ color: 0xffffff, alpha: 1 });
    this.flashG.alpha = 0;
    const border = new Container();
    this.drawBorder(border);
    this.view.addChild(this.light, this.weave, this.layers.backdrop, this.layers.puppets, this.layers.fx, this.slowG, border, this.layers.front, this.flashG);
    // Nothing drawn in the wings spills past the edge of the cloth.
    const clip = new Graphics().rect(0, 0, STAGE_W, STAGE_H).fill(0xffffff);
    this.view.addChild(clip);
    this.view.mask = clip;
    app.stage.addChild(this.view);
  }

  static async create(host: HTMLElement): Promise<Stage> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, globalThis.devicePixelRatio || 1),
      background: 0x0d0705,
      preference: 'webgl',
    });
    host.appendChild(app.canvas);
    const stage = new Stage(app);
    stage.setTheme('battlefield');
    stage.resize();
    return stage;
  }

  /** Fits the stage into the window, keeping 16:9. */
  resize(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    if (w === this.lastW && h === this.lastH) return;
    this.lastW = w;
    this.lastH = h;
    this.fit = Math.min(w / STAGE_W, h / STAGE_H);
    this.offX = (w - STAGE_W * this.fit) / 2;
    this.offY = (h - STAGE_H * this.fit) / 2;
    this.view.scale.set(this.fit);
  }

  /** The stage rectangle in CSS pixels, so the HUD can sit exactly over it. */
  rect(): { x: number; y: number; w: number; h: number; scale: number } {
    return { x: this.offX, y: this.offY, w: STAGE_W * this.fit, h: STAGE_H * this.fit, scale: this.fit };
  }

  setSlow(on: boolean): void {
    this.slowTarget = on ? 1 : 0;
  }

  flash(strength: number, color = 0xffffff): void {
    this.flashG.tint = color;
    this.flashAmt = Math.max(this.flashAmt, strength);
  }

  shake(px: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, px);
  }

  update(dt: number, time: number): void {
    this.resize();
    // Oil-lamp flicker: slow drift plus a faster shimmer.
    const flicker = 1 - 0.035 * (0.5 + 0.5 * Math.sin(time * 7.3)) * (0.5 + 0.5 * Math.sin(time * 2.9 + 1)) - 0.02 * hash01(11, Math.floor(time * 12));
    this.slow += (this.slowTarget - this.slow) * Math.min(1, dt * 9);
    this.light.tint = mix(mix(0x000000, 0xffffff, flicker), 0xb9c8ff, this.slow * 0.55);
    this.slowG.alpha = this.slow * 0.42;
    this.flashAmt = Math.max(0, this.flashAmt - dt * 3.2);
    this.flashG.alpha = Math.min(0.75, this.flashAmt);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 34);
    const s = this.shakeAmt;
    this.view.position.set(this.offX + (s ? (Math.random() - 0.5) * 2 * s * this.fit : 0), this.offY + (s ? (Math.random() - 0.5) * 2 * s * this.fit : 0));
  }

  /** Paints the backdrop for a tradition. */
  setTheme(theme: StageTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    const layer = this.layers.backdrop;
    for (const child of layer.removeChildren()) child.destroy({ children: true });
    const far = new Graphics();
    const near = new Graphics();
    far.blendMode = 'multiply';
    near.blendMode = 'multiply';
    const F = (pts: number[], a = 0.34) => far.poly(pts).fill({ color: FAR, alpha: a });
    const N = (pts: number[], a = 0.5) => near.poly(pts).fill({ color: NEAR, alpha: a });
    const ridge = (base: number, amp: number, seed: number, step = 50): number[] => {
      const pts = [0, FLOOR_Y];
      for (let x = 0; x <= STAGE_W; x += step) pts.push(x, base - amp * (0.5 + 0.5 * Math.sin(x * 0.006 + seed)) - amp * 0.45 * hash01(seed * 31, x));
      pts.push(STAGE_W, FLOOR_Y);
      return pts;
    };
    switch (theme) {
      case 'battlefield': {
        F(ridge(620, 90, 1.3));
        for (const [cx, dir] of [[210, 1], [1390, -1]] as const) {
          N([cx - 90 * dir, 690, cx + 70 * dir, 690, cx + 56 * dir, 610, cx - 80 * dir, 630]);
          N([cx + 70 * dir, 678, cx + 210 * dir, 660, cx + 210 * dir, 652, cx + 70 * dir, 668]);
          near.circle(cx - 10 * dir, 690, 52).fill({ color: NEAR, alpha: 0.5 }).circle(cx - 10 * dir, 690, 40).cut();
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI;
            near.moveTo(cx - 10 * dir + Math.cos(a) * 44, 690 + Math.sin(a) * 44).lineTo(cx - 10 * dir - Math.cos(a) * 44, 690 - Math.sin(a) * 44).stroke({ color: NEAR, width: 5, alpha: 0.5 });
          }
          N([cx - 62 * dir, 632, cx - 56 * dir, 632, cx - 56 * dir, 440, cx - 62 * dir, 440]);
          N([cx - 56 * dir, 440, cx + 30 * dir, 462, cx - 56 * dir, 492], 0.42);
        }
        for (let i = 0; i < 9; i++) {
          const x = 420 + i * 95 + hash01(5, i) * 40;
          N([x, FLOOR_Y, x + 4, FLOOR_Y, x + 14 + hash01(6, i) * 30, 560 + hash01(7, i) * 60, x + 10 + hash01(6, i) * 30, 560 + hash01(7, i) * 60], 0.32);
        }
        break;
      }
      case 'temple': {
        F(ridge(650, 50, 2.1));
        for (const [cx, w, tiers] of [[250, 260, 7], [1350, 260, 7], [800, 180, 5]] as const) {
          for (let t = 0; t < tiers; t++) {
            const y0 = FLOOR_Y - t * 62;
            const half = (w / 2) * (1 - t / (tiers + 1.5));
            (cx === 800 ? F : N)([cx - half, y0, cx + half, y0, cx + half * 0.86, y0 - 62, cx - half * 0.86, y0 - 62], cx === 800 ? 0.3 : 0.46);
          }
          const top = FLOOR_Y - tiers * 62;
          (cx === 800 ? F : N)([cx - 26, top, cx + 26, top, cx, top - 60], cx === 800 ? 0.3 : 0.46);
        }
        for (let i = 0; i < 5; i++) {
          const x = 520 + i * 140;
          near.moveTo(x, 0).lineTo(x, 150 + (i % 2) * 40).stroke({ color: NEAR, width: 3, alpha: 0.45 });
          N([x - 16, 150 + (i % 2) * 40, x + 16, 150 + (i % 2) * 40, x + 22, 196 + (i % 2) * 40, x - 22, 196 + (i % 2) * 40], 0.45);
        }
        break;
      }
      case 'mountains': {
        F([0, FLOOR_Y, 0, 520, 150, 330, 300, 500, 470, 250, 640, 480, 800, 360, 960, 500, 1140, 270, 1310, 480, 1460, 350, 1600, 520, 1600, FLOOR_Y], 0.3);
        N([0, FLOOR_Y, 0, 640, 220, 520, 420, 660, 700, 560, 980, 670, 1240, 540, 1600, 650, 1600, FLOOR_Y], 0.36);
        for (let i = 0; i < 10; i++) {
          const x = 60 + i * 165 + hash01(3, i) * 60;
          const h = 110 + hash01(4, i) * 70;
          N([x, FLOOR_Y, x - 34, FLOOR_Y - h * 0.3, x - 16, FLOOR_Y - h * 0.3, x - 28, FLOOR_Y - h * 0.62, x - 10, FLOOR_Y - h * 0.62, x, FLOOR_Y - h, x + 10, FLOOR_Y - h * 0.62, x + 28, FLOOR_Y - h * 0.62, x + 16, FLOOR_Y - h * 0.3, x + 34, FLOOR_Y - h * 0.3], 0.42);
        }
        break;
      }
      case 'columns': {
        F(ridge(640, 70, 0.4));
        F([330, 250, 800, 130, 1270, 250], 0.3);
        F([330, 250, 1270, 250, 1270, 290, 330, 290], 0.3);
        for (let i = 0; i < 7; i++) {
          const x = 360 + i * 146;
          N([x - 26, 290, x + 26, 290, x + 20, 316, x - 20, 316], 0.4);
          N([x - 20, 316, x + 20, 316, x + 24, FLOOR_Y - 26, x - 24, FLOOR_Y - 26], 0.36);
          N([x - 32, FLOOR_Y - 26, x + 32, FLOOR_Y - 26, x + 32, FLOOR_Y, x - 32, FLOOR_Y], 0.42);
          for (const dx of [-8, 0, 8]) near.moveTo(x + dx, 322).lineTo(x + dx * 1.15, FLOOR_Y - 30).stroke({ color: NEAR, width: 2, alpha: 0.28 });
        }
        break;
      }
      case 'forest': {
        F(ridge(600, 60, 3.3));
        for (let i = 0; i < 9; i++) {
          const x = 70 + i * 185 + hash01(8, i) * 70;
          const w = 22 + hash01(9, i) * 18;
          N([x - w, FLOOR_Y, x + w, FLOOR_Y, x + w * 0.6, 300, x - w * 0.6, 300], 0.4);
          near.poly(arc(x, 250 - hash01(10, i) * 60, 150 + hash01(11, i) * 60, 110, 0, Math.PI * 2, 18)).fill({ color: i % 2 ? NEAR : FAR, alpha: 0.3 });
          near.moveTo(x + 60, 300).quadraticCurveTo(x + 76, 420, x + 52, 520 + hash01(12, i) * 80).stroke({ color: NEAR, width: 3, alpha: 0.32 });
        }
        break;
      }
      case 'desert': {
        far.circle(1240, 250, 92).fill({ color: FAR, alpha: 0.26 });
        F([120, FLOOR_Y, 520, 330, 920, FLOOR_Y], 0.32);
        F([760, FLOOR_Y, 1050, 460, 1340, FLOOR_Y], 0.3);
        N(ridge(700, 40, 4.4, 80), 0.36);
        for (const x of [150, 1450, 1120]) {
          near.moveTo(x, FLOOR_Y).quadraticCurveTo(x + 22, 560, x + 6, 430).stroke({ color: NEAR, width: 12, alpha: 0.42 });
          for (let k = 0; k < 7; k++) {
            const a = -Math.PI * 0.05 - (k / 6) * Math.PI * 0.9;
            near.moveTo(x + 6, 430).quadraticCurveTo(x + 6 + Math.cos(a) * 80, 430 + Math.sin(a) * 80 - 20, x + 6 + Math.cos(a) * 130, 430 + Math.sin(a) * 70 + 34).stroke({ color: NEAR, width: 8, alpha: 0.4 });
          }
        }
        break;
      }
    }
    // The floor: a dark band the puppets stand on, with the rods disappearing into it.
    const floor = new Graphics();
    floor.blendMode = 'multiply';
    floor.rect(0, FLOOR_Y, STAGE_W, STAGE_H - FLOOR_Y).fill({ color: 0x4a2412, alpha: 0.78 });
    floor.moveTo(0, FLOOR_Y).lineTo(STAGE_W, FLOOR_Y).stroke({ color: 0x2a1408, width: 4, alpha: 0.9 });
    for (let x = 20; x < STAGE_W; x += 40) floor.circle(x, FLOOR_Y + 16, 3).fill({ color: 0x2a1408, alpha: 0.5 });
    layer.addChild(far, near, floor);
  }

  /** The hanging border across the top and the dark wings at the sides. */
  private drawBorder(c: Container): void {
    const g = new Graphics();
    g.blendMode = 'multiply';
    g.rect(0, 0, STAGE_W, 34).fill({ color: 0x8f1d14, alpha: 0.92 });
    for (let x = 0; x < STAGE_W; x += 80) {
      g.poly(arc(x + 40, 34, 40, 30, 0, Math.PI, 10)).fill({ color: 0x8f1d14, alpha: 0.9 });
      g.poly([x + 28, 60, x + 52, 60, x + 40, 98]).fill({ color: 0x1f6a34, alpha: 0.85 });
      g.poly([x - 12, 34, x + 12, 34, x, 62]).fill({ color: 0xd99a1c, alpha: 0.9 });
    }
    g.rect(0, 0, 26, STAGE_H).fill({ color: 0x3a1a0c, alpha: 0.8 }).rect(STAGE_W - 26, 0, 26, STAGE_H).fill({ color: 0x3a1a0c, alpha: 0.8 });
    const dots = new Graphics();
    for (let x = 20; x < STAGE_W; x += 40) dots.circle(x, 17, 4).fill({ color: 0xffe9b0, alpha: 0.9 });
    for (let x = 40; x < STAGE_W; x += 80) dots.circle(x, 50, 3).fill({ color: 0xffe9b0, alpha: 0.85 });
    c.addChild(g, dots);
  }

  destroy(): void {
    this.app.destroy({ removeView: true }, { children: true });
  }
}
