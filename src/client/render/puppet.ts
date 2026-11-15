// A jointed leather puppet. The pieces from parts.ts are pinned together at the shoulders, elbows,
// hips and knees; each joint chases its target angle on a slightly loose spring, so limbs swing and
// settle the way a rod puppet's do. Poses come from the fighter's state in the simulation.
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { SLOT_BOX, type SlotBox } from '../../shared/protocol';
import { ANIM_TIMING, type Act } from '../../shared/sim';
import type { Anim, CharacterSheet, Slot, SvgAsset, Weapon } from '../../shared/types';
import { INK } from './draw';
import {
  DIM, buildWidth, drawCape, drawForearm, drawHead, drawShin, drawSkirt, drawTail, drawThigh, drawTorso, drawUpperArm, drawWeapon, drawWings,
} from './parts';

/** Everything the puppet needs to know about its fighter this frame. */
export interface PuppetState {
  act: Act;
  actT: number;
  anim: Anim;
  facing: 1 | -1;
  /** Horizontal speed in metres per second, for the walk cycle and limb sway. */
  vx: number;
  grounded: boolean;
  /** Seconds of wall-clock time, for idle breathing. */
  time: number;
}

type Channel = 'lean' | 'head' | 'aF' | 'eF' | 'aB' | 'eB' | 'lF' | 'kF' | 'lB' | 'kB' | 'wpn' | 'tilt' | 'cape';
type Pose = Record<Channel, number>;
const CHANNELS: Channel[] = ['lean', 'head', 'aF', 'eF', 'aB', 'eB', 'lF', 'kF', 'lB', 'kB', 'wpn', 'tilt', 'cape'];

const zero = (): Pose => ({ lean: 0, head: 0, aF: 0, eF: 0, aB: 0, eB: 0, lF: 0, kF: 0, lB: 0, kB: 0, wpn: 0, tilt: 0, cape: 0 });

/** How each kind of weapon is carried at rest: shoulder, elbow, and the weapon's own turn in the hand. */
const HOLD: Record<Weapon, [number, number, number]> = {
  bow: [0.95, 0.5, 0], mace: [0.5, 1.0, 0.1], hammer: [0.45, 1.0, 0.15], sword: [0.5, 0.95, 0.25], spear: [0.6, 0.9, 0],
  trident: [0.6, 0.9, 0], staff: [0.6, 0.9, 0], chakra: [0.7, 1.3, 0], axe: [0.45, 1.0, 0.15], fists: [0.85, 1.55, 0],
};

const HALF_PI = Math.PI / 2;
const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

const textureCache = new Map<string, Promise<Texture>>();

/** Rasterises sanitised SVG through the browser's own image decoder, where SVG cannot run code. */
function svgTexture(asset: SvgAsset, box: SlotBox): Promise<Texture> {
  const cached = textureCache.get(asset.id);
  if (cached) return cached;
  const scale = 3;
  const job = (async () => {
    const sized = asset.svg.replace(/^<svg /, `<svg width="${box.w * scale}" height="${box.h * scale}" `);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = box.w * scale;
    canvas.height = box.h * scale;
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return Texture.from(canvas);
  })();
  textureCache.set(asset.id, job);
  job.catch(() => textureCache.delete(asset.id));
  return job;
}

export class Puppet {
  /** Positioned at the feet. Scale it to resize; flip `scale.x` is handled by `update`. */
  readonly root = new Container();
  readonly sheet: CharacterSheet;
  private readonly size: number;
  private readonly bw: number;
  private readonly rods = new Graphics();
  private readonly body = new Container();
  private readonly back = new Container();
  private readonly torso = new Container();
  private readonly head = new Container();
  private readonly armF = new Container();
  private readonly foreF = new Container();
  private readonly armB = new Container();
  private readonly foreB = new Container();
  private readonly legF = new Container();
  private readonly shinF = new Container();
  private readonly legB = new Container();
  private readonly shinB = new Container();
  private readonly weapon = new Container();
  private readonly cape: Container | null = null;
  private readonly tail: Container | null = null;
  private stringRest: Graphics | null = null;
  private stringDrawn: Graphics | null = null;
  private readonly pose = zero();
  private readonly vel = zero();
  private hip: number = DIM.thigh + DIM.shin + DIM.foot;
  private phase = 0;
  private lastVx = 0;
  private hideWeapon = 0;
  private flash = 0;
  private destroyed = false;
  private first = true;

  constructor(sheet: CharacterSheet, size = 1) {
    this.sheet = sheet;
    this.size = size;
    const look = sheet.look;
    const bw = (this.bw = buildWidth(look));
    const custom = look.custom ?? {};
    const S = 28 * bw;
    const shoulderY = -72;

    // Draw order, back to front: what hangs behind, back arm, legs, torso, head, front arm.
    this.root.addChild(this.rods, this.body);
    this.body.addChild(this.back, this.legB, this.legF, this.torso);

    if (look.extras.includes('wings')) {
      const w = drawWings(look).c;
      w.position.set(-S + 8, shoulderY - 4);
      this.back.addChild(w);
    }
    if (look.cape) {
      this.cape = drawCape(look, bw).c;
      this.cape.position.set(0, -DIM.torso + 4);
      this.back.addChild(this.cape);
    }
    if (look.extras.includes('tail')) {
      this.tail = drawTail(look).c;
      this.tail.position.set(-8, -8);
      this.back.addChild(this.tail);
    }

    const limb = (upper: Container, lower: Container, upperArt: Container, lowerArt: Container, x: number, y: number, len: number) => {
      upper.position.set(x, y);
      upper.addChild(upperArt, lower);
      lower.position.set(0, len);
      lower.addChild(lowerArt);
    };
    const plainTop = custom.top !== undefined;
    limb(this.armB, this.foreB, drawUpperArm(look, bw, plainTop).c, drawForearm(look, bw, plainTop).c, -S + 5, shoulderY, DIM.upper);
    this.back.addChild(this.armB);

    const legLook = custom.bottom ? { ...look, bottom: 'loincloth' as const } : look;
    limb(this.legB, this.shinB, drawThigh(legLook, bw).c, drawShin(legLook, bw).c, -10 * bw, 0, DIM.thigh);
    limb(this.legF, this.shinF, drawThigh(legLook, bw).c, drawShin(legLook, bw).c, 10 * bw, 0, DIM.thigh);

    this.torso.addChild(drawTorso(look, bw, plainTop).c);
    if (custom.top) this.attach(custom.top, 'top', this.torso, 0, 0, bw);
    if (custom.bottom) this.attach(custom.bottom, 'bottom', this.torso, 0, 0, bw);
    else {
      const skirt = drawSkirt(look, bw);
      if (skirt) this.torso.addChild(skirt.c);
    }

    const h = drawHead(look, custom.headgear === undefined);
    this.head.position.set(0, -DIM.torso - DIM.neck - 22);
    this.head.addChild(h.back.c, h.face.c, h.gear.c);
    if (custom.headgear) this.attach(custom.headgear, 'headgear', this.head, 0, 0, 1);
    this.torso.addChild(this.head);

    limb(this.armF, this.foreF, drawUpperArm(look, bw, plainTop).c, drawForearm(look, bw, plainTop).c, S - 5, shoulderY, DIM.upper);
    this.torso.addChild(this.armF);

    this.weapon.position.set(0, DIM.fore + DIM.hand);
    if (custom.weapon) this.attach(custom.weapon, 'weapon', this.weapon, 0, 0, 1);
    else {
      const w = drawWeapon(sheet.weapon, look);
      this.weapon.addChild(w.part.c);
      this.stringRest = w.stringRest ?? null;
      this.stringDrawn = w.stringDrawn ?? null;
    }
    // The weapon goes under the hand so fingers appear to grip it.
    this.foreF.addChildAt(this.weapon, 0);

    this.root.scale.set(size);
  }

  /** Adds an AI-cut piece as a multiply-blended sprite pinned at its anchor point. */
  private attach(asset: SvgAsset, slot: Slot, parent: Container, x: number, y: number, widen: number): void {
    const box = SLOT_BOX[slot];
    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(box.ax / box.w, box.ay / box.h);
    sprite.position.set(x, y);
    sprite.blendMode = 'multiply';
    sprite.alpha = 0.95;
    sprite.label = `custom:${slot}`;
    parent.addChild(sprite);
    void svgTexture(asset, box)
      .then((tex) => {
        if (this.destroyed) return;
        sprite.texture = tex;
        sprite.scale.set((1 / 3) * widen, 1 / 3);
      })
      .catch(() => {
        sprite.visible = false;
      });
  }

  /** Briefly reddens the puppet when it is struck. */
  hit(): void {
    this.flash = 0.16;
  }

  /** Where the front hand is, in the puppet's parent space. Used to start effects at the hand. */
  handPoint(): { x: number; y: number } {
    const p = this.weapon.getGlobalPosition();
    const parent = this.root.parent;
    return parent ? parent.toLocal(p) : p;
  }

  private target(s: PuppetState): Pose {
    const t = zero();
    const [ha, he, hw] = HOLD[this.sheet.weapon];
    const breathe = Math.sin(s.time * 2.1);
    Object.assign(t, { lean: 0.03 + breathe * 0.012, aF: ha + breathe * 0.02, eF: he, aB: -0.18, eB: 0.35, lF: 0.13, kF: -0.1, lB: -0.15, kB: -0.12, wpn: hw });
    if (this.sheet.weapon === 'fists') Object.assign(t, { aB: 0.6, eB: 1.7 });

    switch (s.act) {
      case 'walk': {
        const p = this.phase;
        Object.assign(t, {
          lean: 0.1, lF: 0.62 * Math.sin(p), kF: -0.12 - 0.7 * Math.max(0, -Math.sin(p - 0.7)),
          lB: -0.62 * Math.sin(p), kB: -0.12 - 0.7 * Math.max(0, Math.sin(p - 0.7)), aB: 0.45 * Math.sin(p) - 0.1, eB: 0.5,
        });
        break;
      }
      case 'jump':
        Object.assign(t, { lean: 0.14, lF: 0.95, kF: -1.35, lB: 0.25, kB: -1.05, aB: -0.95, eB: 0.6, aF: ha + 0.45, cape: -0.5 });
        break;
      case 'crouch':
        Object.assign(t, { lean: 0.85, head: -0.55, lF: 1.45, kF: -2.5, lB: 1.2, kB: -2.4, aF: 0.2, eF: 1.5, aB: 0.1, eB: 1.2 });
        break;
      case 'attack':
      case 'cast': {
        const timing = ANIM_TIMING[s.anim];
        const w = Math.max(0.02, timing.windup);
        const pre = s.act === 'attack' && s.actT < w;
        const k = ease((s.actT - w) / 0.09);
        switch (s.anim) {
          case 'shoot':
            Object.assign(t, { lean: -0.06, aF: HALF_PI, eF: 0.03, wpn: 0, aB: pre ? 1.25 : 0.7, eB: pre ? 1.95 : 0.5, lF: 0.3, lB: -0.3 });
            break;
          case 'swing':
            Object.assign(t, pre ? { lean: -0.2, aF: 2.95, eF: 0.5, wpn: 0.3, lF: 0.1, lB: -0.35 } : { lean: 0.34, aF: 0.55 + (1 - k) * 2, eF: 0.1, wpn: 0.5, lF: 0.5, kF: -0.3, lB: -0.4 });
            break;
          case 'throw':
            Object.assign(t, pre ? { lean: -0.22, aF: 2.7, eF: 1.2, lB: -0.35 } : { lean: 0.28, aF: 1.4, eF: 0.05, lF: 0.45, kF: -0.25, lB: -0.4 });
            break;
          case 'cast':
            Object.assign(t, { lean: -0.1, head: -0.28, aF: 2.35, eF: 0.3, aB: 2.05, eB: 0.4, lF: 0.2, lB: -0.25 });
            break;
          case 'thrust':
            Object.assign(t, pre
              ? { lean: -0.08, aF: 0.6, eF: 2.0, wpn: HALF_PI, lB: -0.2 }
              : { lean: 0.24, aF: 1.5, eF: 0.03, wpn: HALF_PI, lF: 0.55, kF: -0.35, lB: -0.45, ...(this.sheet.weapon === 'fists' ? { aB: 1.42, eB: 0.1 } : {}) });
            break;
          case 'slam':
            Object.assign(t, pre ? { lean: -0.25, aF: 3.0, eF: 0.3, aB: 2.8, eB: 0.4 } : { lean: 0.45, aF: 0.85, eF: 0.1, aB: 0.7, eB: 0.2, lF: 0.6, kF: -0.7, lB: 0.2, kB: -0.7 });
            break;
          case 'guard':
            Object.assign(t, { lean: -0.06, aF: 1.3, eF: 1.9, aB: 1.15, eB: 2.0, lF: 0.25, lB: -0.3 });
            break;
        }
        break;
      }
      case 'hit':
        Object.assign(t, { lean: -0.38, head: -0.4, aF: -0.3, eF: 0.4, aB: -0.95, eB: 0.3, lF: 0.35, kF: -0.3, lB: -0.25, cape: 0.5 });
        break;
      case 'ko':
        Object.assign(t, { tilt: 1.47, lean: -0.1, head: -0.3, aF: -0.7, eF: 0.3, aB: -2.2, eB: 0.2, lF: 0.5, kF: -0.4, lB: 0.2, kB: -0.25, wpn: 0.9 });
        break;
      case 'win': {
        const bounce = Math.abs(Math.sin(s.time * 5));
        Object.assign(t, { lean: -0.08, head: -0.25, aF: 2.85 + bounce * 0.1, eF: 0.15, aB: 2.5, eB: 0.4, lF: 0.2, lB: -0.25 });
        break;
      }
      case 'idle':
        break;
    }
    if (s.act !== 'jump' && s.act !== 'hit') t.cape = Math.max(-0.6, Math.min(0.6, -s.vx * 0.07));
    return t;
  }

  /** Advances the springs by `dt` seconds and places every piece. (x, y) are the feet, in parent space. */
  update(dt: number, s: PuppetState, x: number, y: number): void {
    const step = Math.min(dt, 1 / 30);
    this.phase += Math.abs(s.vx) * step * 4.2;
    const target = this.target(s);
    const quick = s.act === 'attack' || s.act === 'cast' || s.act === 'hit';
    // Limbs lag behind sudden starts and stops, as loose-jointed pieces do.
    const jolt = step > 0 ? (s.vx - this.lastVx) / Math.max(step, 1e-3) : 0;
    this.lastVx = s.vx;
    for (const c of CHANNELS) {
      if (this.first) {
        this.pose[c] = target[c];
        continue;
      }
      const stiff = c === 'tilt' ? 70 : c === 'cape' ? 40 : quick ? 620 : 240;
      const damp = c === 'tilt' ? 11 : c === 'cape' ? 6 : quick ? 34 : 21;
      let acc = stiff * (target[c] - this.pose[c]) - damp * this.vel[c];
      if (c === 'aB' || c === 'head') acc -= jolt * 0.012;
      if (c === 'eB') acc -= jolt * 0.02;
      this.vel[c] += acc * step;
      this.pose[c] += this.vel[c] * step;
    }
    this.first = false;
    const p = this.pose;

    this.torso.rotation = p.lean;
    this.back.rotation = p.lean;
    this.head.rotation = p.head;
    this.armF.rotation = -p.aF;
    this.foreF.rotation = -p.eF;
    this.armB.rotation = -p.aB;
    this.foreB.rotation = -p.eB;
    this.legF.rotation = -p.lF;
    this.shinF.rotation = -p.kF;
    this.legB.rotation = -p.lB;
    this.shinB.rotation = -p.kB;
    this.weapon.rotation = HALF_PI + p.wpn;
    if (this.cape) this.cape.rotation = p.cape - p.lean * 0.6;
    if (this.tail) this.tail.rotation = Math.sin(s.time * 2.4) * 0.12 + p.cape * 0.5;

    // The hip rides at whatever height keeps the lower foot on the floor.
    const reach = (hip: number, knee: number) => DIM.thigh * Math.cos(hip) + DIM.shin * Math.cos(hip + knee) + DIM.foot;
    const standing = Math.max(reach(p.lF, p.kF), reach(p.lB, p.kB), 34);
    const fallen = Math.min(1, Math.abs(p.tilt) / 1.4);
    this.hip = standing * (1 - fallen) + 16 * fallen;
    this.body.position.set(0, -this.hip);
    this.body.rotation = -p.tilt;

    this.root.position.set(x, y);
    this.root.scale.set(this.size * s.facing, this.size);

    // The thrown weapon leaves the hand until it would have returned.
    if (s.act === 'attack' && s.anim === 'throw' && s.actT >= ANIM_TIMING.throw.windup && this.sheet.weapon !== 'fists') this.hideWeapon = 0.55;
    this.hideWeapon = Math.max(0, this.hideWeapon - step);
    this.weapon.visible = this.hideWeapon <= 0;
    const drawing = s.act === 'attack' && s.anim === 'shoot' && s.actT < ANIM_TIMING.shoot.windup;
    if (this.stringRest && this.stringDrawn) {
      this.stringRest.visible = !drawing;
      this.stringDrawn.visible = drawing;
    }

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - step);
      this.body.tint = this.flash > 0 ? 0xff9a7a : 0xffffff;
    }

    // The puppeteer's rods: one through the body, one to the leading hand.
    this.rods.clear();
    if (fallen < 0.5) {
      const S = 28 * this.bw;
      const sx = (S - 5) * Math.cos(p.lean) + 72 * Math.sin(p.lean);
      const sy = -this.hip + (S - 5) * Math.sin(p.lean) - 72 * Math.cos(p.lean);
      const a1 = p.aF - p.lean;
      const a2 = a1 + p.eF;
      const hx = sx + DIM.upper * Math.sin(a1) + (DIM.fore + DIM.hand) * Math.sin(a2);
      const hy = sy + DIM.upper * Math.cos(a1) + (DIM.fore + DIM.hand) * Math.cos(a2);
      this.rods.moveTo(0, -this.hip + 6).lineTo(0, 150).stroke({ color: INK, width: 3.2, alpha: 0.42 });
      this.rods.moveTo(hx, hy).lineTo(hx * 0.55 + 10, 150).stroke({ color: INK, width: 2.2, alpha: 0.34 });
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.destroy({ children: true });
  }
}
