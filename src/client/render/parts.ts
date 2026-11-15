// The pieces a puppet is cut from: head, headgear, torso, garments, limbs, weapons and extras. Each
// function draws one piece in its own local frame (y down, the figure facing +x) from a PuppetLook,
// so any character sheet, built in, summoned or forged, renders in the same leather-puppet style.
import { Graphics } from 'pixi.js';
import type { PuppetLook, Weapon } from '../../shared/types';
import { BONE, HOLE, INK, Part, STEEL, WOOD, arc, col, darken, lighten, quad, ribbon } from './draw';

export const DIM = { thigh: 62, shin: 60, foot: 8, torso: 82, neck: 8, upper: 46, fore: 44, hand: 5, headUp: 30 } as const;

export function buildWidth(look: PuppetLook): number {
  return look.build === 'heavy' ? 1.2 : look.build === 'slim' ? 0.86 : 1;
}

interface Dyes {
  skin: number;
  hair: number;
  pri: number;
  sec: number;
  acc: number;
}

export function dyes(look: PuppetLook): Dyes {
  return { skin: col(look.skin), hair: col(look.hairColor), pri: col(look.primary), sec: col(look.secondary), acc: col(look.accent) };
}

/** The brass rivet that pins two pieces together at a joint. */
export function rivet(p: Part, x = 0, y = 0): void {
  p.h.circle(x, y, 3.1).fill({ color: 0x2a1a10, alpha: 0.95 });
  p.h.circle(x, y, 1.5).fill({ color: 0xe8c07a, alpha: 1 });
}

// --- Head -----------------------------------------------------------------------------------------

const HEADS: Record<PuppetLook['species'], number[]> = {
  human: [-22, -6, -19, -18, -10, -25, 3, -27, 15, -23, 21, -14, 23, -6, 24, -1, 32, 7, 26, 9, 27, 12, 24, 14, 26, 17, 23, 24, 12, 28, 0, 24, -10, 18, -19, 8],
  monkey: [-22, -6, -19, -18, -10, -25, 3, -27, 14, -23, 19, -14, 21, -6, 27, -3, 35, 1, 40, 8, 38, 17, 30, 22, 20, 25, 10, 27, 0, 24, -10, 18, -19, 8],
  jackal: [-19, -4, -17, -18, -8, -26, 4, -28, 14, -22, 22, -13, 34, -5, 48, 1, 53, 7, 49, 13, 34, 15, 23, 20, 12, 26, 0, 24, -10, 18, -17, 8],
  bird: [-22, -6, -19, -18, -10, -25, 3, -27, 15, -23, 22, -14, 30, -8, 45, 2, 40, 8, 30, 9, 24, 13, 22, 22, 12, 28, 0, 24, -10, 18, -19, 8],
};

export interface HeadParts {
  /** Hair and anything else that sits behind the face. */
  back: Part;
  face: Part;
  /** Headgear, in front of the face. */
  gear: Part;
}

export function drawHead(look: PuppetLook, withGear: boolean): HeadParts {
  const d = dyes(look);
  const back = new Part('hair');
  const face = new Part('face');
  const gear = new Part('headgear');
  const human = look.species === 'human';

  // Hair, behind the skull.
  if (look.hair !== 'bald' && look.species !== 'jackal') {
    if (look.hair === 'long') back.poly([-24, -6, -22, -20, -10, -29, 4, -31, 14, -27, 4, -22, -8, -18, -14, -6, -13, 12, -17, 30, -21, 46, -35, 48, -33, 24, -29, 6], d.hair);
    else back.poly([-24, -3, -23, -19, -11, -29, 4, -31, 16, -26, 20, -19, 8, -22, -6, -20, -14, -10, -15, 5, -22, 9], d.hair);
    if (look.hair === 'bun') back.circle(-25, -20, 10, d.hair).line([-31, -22, -19, -18], 1.2, 0.6);
    if (look.hair === 'braid') {
      for (let i = 0; i < 5; i++) back.ellipse(-22 - i * 1.5, 12 + i * 11, 6 - i * 0.5, 7, d.hair, 1.6);
      back.circle(-29, 68, 4, d.acc, 1.4);
    }
  }
  if (look.extras.includes('halo')) {
    back.poly(ribbon(arc(0, -4, 42, 42, 0, Math.PI * 2, 28), () => 7), lighten(d.acc, 0.15), 1.8);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      back.hole(Math.cos(a) * 42, -4 + Math.sin(a) * 42, 1.4);
    }
  }

  // Animal ears sit behind the skull so the outline stays clean.
  if (look.species === 'jackal') {
    back.poly([-11, -22, -15, -58, 1, -32], d.skin).poly([-2, -25, 3, -60, 12, -27], d.skin);
    back.poly([-9, -28, -12, -48, -3, -34], darken(d.acc, 0.1), 1.2);
  }
  if (look.species === 'monkey') back.circle(-10, -2, 9, d.skin).circle(-10, -2, 4.5, lighten(d.skin, 0.25), 1.2);
  if (look.species === 'bird') back.poly([-6, -25, -12, -42, -1, -31, 1, -46, 8, -28], d.pri);

  face.poly(HEADS[look.species], d.skin, 2.4);
  if (look.species === 'monkey') {
    face.ellipse(29, 11, 11, 10, lighten(d.skin, 0.35), 1.4);
    face.line([38, 15, 24, 18], 1.4).line([35, 5, 37, 7], 1.6);
  } else if (look.species === 'jackal') {
    face.line([49, 12, 28, 14], 1.3).poly([48, 2, 54, 6, 49, 9], INK, 0);
    if (look.jewelry > 0) face.poly([18, -16, 30, -8, 28, -5, 16, -12], d.acc, 1.2);
  } else if (look.species === 'bird') {
    face.poly([22, -11, 45, 2, 39, 8, 24, 10], d.acc, 1.8).line([42, 4, 28, 5], 1.2);
  } else {
    face.line([24, 14, 18, 14.6], 1.5);
    face.ellipse(-6, 3, 4.6, 7, d.skin, 1.6).line([-7, 0, -5, 5], 1, 0.6);
  }

  // The long, lined eye of the leather puppets.
  const ex = look.species === 'jackal' ? 15 : 11;
  const ey = look.species === 'jackal' ? -9 : -4;
  face.h.moveTo(ex - 8.5, ey).quadraticCurveTo(ex, ey - 7, ex + 9, ey).quadraticCurveTo(ex, ey + 4.5, ex - 8.5, ey).fill({ color: HOLE, alpha: 1 });
  face.h.circle(ex + 1.5, ey - 0.6, 2.9).fill({ color: INK, alpha: 1 });
  face.h.moveTo(ex - 10, ey + 0.5).quadraticCurveTo(ex, ey - 8.5, ex + 10, ey - 0.5).lineTo(ex + 14, ey - 2.5).stroke({ color: INK, width: 2, alpha: 0.95, cap: 'round' });
  face.h.moveTo(ex - 9, ey - 8).quadraticCurveTo(ex + 1, ey - 14, ex + 12, ey - 8.5).stroke({ color: INK, width: 1.8, alpha: 0.9, cap: 'round' });

  if (look.faceMark === 'tilak') face.poly([15.5, -21, 18.5, -21, 18, -13, 16, -13], 0xc92a1c, 1);
  else if (look.faceMark === 'bindi') face.h.circle(18, -15, 2.2).fill({ color: 0xc92a1c, alpha: 1 });
  else if (look.faceMark === 'third_eye') {
    face.h.moveTo(17, -22).quadraticCurveTo(21, -17, 17, -12).quadraticCurveTo(13, -17, 17, -22).fill({ color: HOLE, alpha: 1 });
    face.h.circle(17, -17, 1.5).fill({ color: INK, alpha: 1 });
  } else if (look.faceMark === 'warpaint') face.line([6, 4, 16, 8], 2.4).line([5, 9, 14, 13], 2.4);

  if (human) {
    if (look.facialHair === 'beard' || look.facialHair === 'full') face.poly([25, 16, 27, 24, 21, 38, 9, 43, -2, 35, -10, 18, 0, 22, 12, 24, 21, 20], d.hair, 1.8);
    if (look.facialHair === 'mustache' || look.facialHair === 'full') face.poly([27, 9, 18, 7.5, 8, 8, 2, 3, 5, 11, 14, 13.5, 24, 12.5], darken(d.hair, 0.2), 1.4);
    if (look.jewelry > 0) face.circle(-6, 14, 4.2, d.acc, 1.4).hole(-6, 14, 1.2);
  }
  if (look.extras.includes('horns')) {
    gear.poly(ribbon(quad(6, -24, 14, -44, 32, -50), (t) => 9 * (1 - t) + 1.5), BONE, 1.8);
    back.poly(ribbon(quad(-8, -25, -6, -46, 10, -56), (t) => 8 * (1 - t) + 1.5), darken(BONE, 0.15), 1.8);
  }
  if (withGear) drawHeadgear(look, d, gear, back);
  return { back, face, gear };
}

function drawHeadgear(look: PuppetLook, d: Dyes, g: Part, back: Part): void {
  switch (look.headgear) {
    case 'kirita': {
      // The tall tiered crown of the epics, with a fan behind the ear.
      back.poly([-20, -12, -33, -26, -39, -8, -31, 8, -20, 3], d.acc).holes(-33, -18, -32, 2, 3, 1.5);
      g.poly([-20, -22, 20, -19, 15, -38, -16, -40], d.sec).holes(-14, -30, 14, -28, 5, 1.6);
      g.poly([-15, -40, 14, -38, 10, -54, -10, -55], d.acc).holes(-9, -47, 9, -46, 4, 1.5);
      g.poly([-9, -55, 9, -54, 4, -68, -4, -68], d.sec).holes(-3, -61, 3, -61, 2, 1.4);
      g.circle(0, -73, 5.5, d.acc).poly([-2.5, -78, 2.5, -78, 0, -90], d.acc, 1.6);
      g.poly([-22, -14, 23, -11, 23, -20, -22, -23], d.acc).holes(-17, -18, 18, -15.5, 7, 1.5);
      g.circle(22, -15.5, 4, d.sec, 1.4);
      break;
    }
    case 'winged_helm':
    case 'horned_helm':
    case 'plume_helm': {
      const metal = look.headgear === 'plume_helm' ? d.acc : lighten(d.acc, 0.05);
      if (look.headgear === 'winged_helm') {
        back.poly([-6, -24, -22, -60, -13, -51, -17, -67, -7, -54, -7, -70, 2, -50, 5, -28], lighten(d.sec, 0.2), 1.8);
        back.line([-10, -34, -17, -56], 1).line([-5, -34, -9, -60], 1).line([0, -32, -3, -58], 1);
      }
      if (look.headgear === 'plume_helm') {
        back.poly(ribbon(arc(-2, -18, 30, 30, -0.35, -Math.PI - 0.5, 16), (t) => 7 + 9 * Math.sin(t * Math.PI)), d.sec, 2);
        for (let i = 1; i < 8; i++) {
          const a = -0.35 + ((-Math.PI - 0.15) * i) / 8;
          back.line([-2 + Math.cos(a) * 24, -18 + Math.sin(a) * 24, -2 + Math.cos(a) * 36, -18 + Math.sin(a) * 36], 1, 0.6);
        }
      }
      g.poly([-23, -3, -22, -19, -11, -29, 4, -31, 17, -26, 23, -16, 24, -8, 17, -10, 4, -12, -10, -9], metal);
      g.poly([-23, -5, -10, -10, 4, -13, 24, -9, 24, -4, 4, -8, -10, -5, -23, 0], darken(metal, 0.12), 1.6).holes(-17, -5, 19, -8, 6, 1.3);
      if (look.headgear !== 'plume_helm') g.poly([20, -9, 24, -8, 26, 2, 22, 1], metal, 1.6);
      else g.poly([4, -8, 15, -9, 13, 10, 6, 15], metal, 1.8);
      if (look.headgear === 'horned_helm') {
        g.poly(ribbon(quad(8, -27, 18, -42, 34, -52), (t) => 10 * (1 - t) + 1.5), BONE, 1.8);
        back.poly(ribbon(quad(-10, -27, -14, -46, -2, -60), (t) => 9 * (1 - t) + 1.5), darken(BONE, 0.15), 1.8);
      }
      break;
    }
    case 'turban': {
      g.poly(arc(0, -22, 27, 16, 0, Math.PI * 2, 18), d.sec, 2.2);
      g.line(arc(0, -16, 25, 12, Math.PI * 1.05, Math.PI * 1.95, 10), 1.2).line(arc(0, -22, 22, 12, Math.PI * 1.1, Math.PI * 1.9, 10), 1.2);
      g.poly([13, -34, 19, -56, 25, -34], d.acc, 1.6).circle(19, -30, 4, d.acc, 1.4).hole(19, -30, 1.3);
      break;
    }
    case 'topknot': {
      g.circle(-2, -37, 12, d.hair).line([-9, -40, 5, -34], 1, 0.6).line([-8, -34, 4, -42], 1, 0.6);
      g.poly([-11, -29, 8, -28, 8, -23, -11, -24], d.acc, 1.6);
      g.poly([-22, -14, 23, -11, 23, -15, -22, -18], d.acc, 1.4);
      break;
    }
    case 'laurel': {
      for (let i = 0; i < 8; i++) {
        const a = -0.25 - (i / 7) * (Math.PI - 0.1);
        const x = Math.cos(a) * 25;
        const y = -6 + Math.sin(a) * 23;
        const nx = Math.cos(a) * 9;
        const ny = Math.sin(a) * 9;
        g.poly([x - ny * 0.45, y + nx * 0.45, x + nx, y + ny, x + ny * 0.45, y - nx * 0.45, x - nx * 0.3, y - ny * 0.3], d.acc, 1.3);
      }
      break;
    }
    case 'nemes': {
      back.poly([-10, -27, -25, -15, -31, 10, -34, 44, -14, 44, -13, 14, -9, -2], d.pri);
      for (let i = 0; i < 6; i++) back.line([-30 + i * 0.4, -4 + i * 8, -12, -2 + i * 8], 2.2, 0.75);
      g.poly([22, -13, 16, -26, 2, -31, -12, -28, -24, -15, -22, -5, -8, -10, 8, -13], d.pri);
      for (let i = 0; i < 5; i++) g.line([-18 + i * 8, -22 - (i < 3 ? i * 3 : 6), -14 + i * 8, -9], 2.2, 0.75);
      g.poly(ribbon(quad(21, -15, 30, -18, 27, -28), () => 3.5), d.acc, 1.3);
      break;
    }
    case 'circlet': {
      g.poly([-22, -12, 23, -9, 23, -15, -22, -18], d.acc, 1.6).circle(22, -12, 4.2, d.sec, 1.4).hole(22, -12, 1.2);
      break;
    }
    case 'hood': {
      back.poly([-12, -30, -29, -14, -32, 16, -24, 34, -6, 34, -11, 14, -13, -6], d.sec);
      g.poly([20, -22, 4, -33, -14, -30, -27, -14, -24, -2, -12, -8, 0, -17, 16, -14], d.sec);
      break;
    }
    case 'none':
      break;
  }
}

// --- Torso and what hangs from the belt -------------------------------------------------------------

export function drawTorso(look: PuppetLook, bw: number, plain: boolean): Part {
  const d = dyes(look);
  const p = new Part('torso');
  const W = 17 * bw;
  const S = 28 * bw;
  const H = DIM.torso;
  const body = [-W, 0, W, 0, S, -66, S - 3, -78, 9, -H, -9, -H, -S + 3, -78, -S, -66];
  p.poly([-7, -H + 3, 7, -H + 3, 6, -H - 12, -6, -H - 12], d.skin, 2);
  const top = plain ? 'bare' : look.top;
  const skinTop = top === 'bare' || top === 'sash' || top === 'vest';
  p.poly(body, skinTop ? d.skin : d.pri, 2.4);

  if (skinTop) {
    p.line([-S + 8, -57, -3, -50], 1.2, 0.6).line([3, -50, S - 8, -57], 1.2, 0.6);
    p.g.circle(0, -18, 1.5).fill({ color: INK, alpha: 0.8 });
  }
  if (plain) {
    // A custom garment covers the chest; only the belt is drawn here.
  } else if (top === 'sash') {
    p.poly([-S + 1, -73, -S + 13, -80, W + 1, -12, W + 1, 0, W - 12, 0], d.sec, 2);
    p.holes(-S + 9, -70, W - 4, -6, 7, 1.5);
  } else if (top === 'vest') {
    p.poly([-S, -66, -S + 3, -78, -10, -H, -7, -40, -W, 0], d.pri, 2).poly([S, -66, S - 3, -78, 10, -H, 7, -40, W, 0], d.pri, 2);
    p.holes(-9, -74, -8, -12, 6, 1.3).holes(9, -74, 8, -12, 6, 1.3);
  } else if (top === 'armor') {
    for (let row = 0; row < 5; row++) {
      const y = -68 + row * 12;
      const half = S - 5 - row * ((S - W) / 6);
      const n = Math.max(3, Math.round((half * 2) / 11));
      for (let i = 0; i < n; i++) p.line(arc(-half + (half * 2 * (i + 0.5)) / n, y, half / n, 6, 0, Math.PI, 5), 1.1, 0.7);
    }
    p.circle(0, -54, 9, d.acc, 1.8).hole(0, -54, 2.4);
    for (let i = 0; i < 6; i++) p.hole(Math.cos((i / 6) * Math.PI * 2) * 5.5, -54 + Math.sin((i / 6) * Math.PI * 2) * 5.5, 0.9);
    p.poly([-S + 3, -78, -9, -H, -6, -74, -S + 6, -70], d.acc, 1.6).poly([S - 3, -78, 9, -H, 6, -74, S - 6, -70], d.acc, 1.6);
  } else if (top === 'tunic') {
    p.poly([-9, -H, 9, -H, 0, -H + 22], d.skin, 1.8);
    p.line([0, -H + 22, 0, -12], 1.2, 0.6).holes(0, -54, 0, -18, 4, 1.4);
    p.poly([-S, -66, -S + 3, -78, -S + 9, -76, -S + 7, -64], d.sec, 1.4).poly([S, -66, S - 3, -78, S - 9, -76, S - 7, -64], d.sec, 1.4);
  } else if (top === 'robe') {
    p.poly([-6, -H + 2, 6, -H + 2, 6, 0, -6, 0], d.sec, 1.6).holes(0, -72, 0, -14, 6, 1.5);
    p.line([-S + 4, -66, -8, -H + 4], 1.2, 0.6).line([S - 4, -66, 8, -H + 4], 1.2, 0.6);
  }

  if (!plain && skinTop && look.jewelry > 0) {
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (0.12 + (0.76 * i) / 8);
      p.hole(Math.cos(a) * 15, -H + 4 + Math.sin(a) * 15, 1.5);
    }
    if (look.jewelry > 1) {
      p.poly(ribbon(arc(0, -H + 4, 23, 26, Math.PI * 0.12, Math.PI * 0.88, 10), () => 4), d.acc, 1.4);
      p.circle(0, -H + 31, 5.5, d.acc, 1.5).hole(0, -H + 31, 1.6);
    }
  }
  p.poly([-W - 3, -10, W + 3, -10, W + 4, 2, -W - 4, 2], d.acc, 1.9).holes(-W, -4, W, -4, 6, 1.4);
  p.circle(0, -4, 5.2, d.sec, 1.5);
  return p;
}

export function drawSkirt(look: PuppetLook, bw: number): Part | null {
  const d = dyes(look);
  const p = new Part('skirt');
  const W = 17 * bw;
  switch (look.bottom) {
    case 'dhoti':
      p.poly([-10, 0, 10, 0, 17, 58, 9, 54, 0, 67, -9, 54, -17, 58], d.sec, 2);
      p.line([-4, 3, -9, 54], 1.1, 0.6).line([0, 3, 0, 66], 1.1, 0.6).line([4, 3, 9, 54], 1.1, 0.6).holes(-12, 50, 12, 50, 5, 1.4);
      p.poly([W - 3, 0, W + 5, 0, W + 12, 34, W + 6, 30, W + 2, 40], d.acc, 1.6);
      return p;
    case 'skirt': {
      const b = 36 * bw;
      p.poly([-W - 3, 0, W + 3, 0, b, 112, b * 0.7, 118, b * 0.35, 113, 0, 119, -b * 0.35, 113, -b * 0.7, 118, -b, 112], d.pri, 2.2);
      p.line([-W * 0.5, 4, -b * 0.6, 112], 1.1, 0.5).line([W * 0.5, 4, b * 0.6, 112], 1.1, 0.5).line([0, 4, 0, 116], 1.1, 0.5);
      p.poly([-b + 1.5, 98, b - 1.5, 98, b, 108, -b, 108], d.sec, 1.5).holes(-b + 6, 103, b - 6, 103, 9, 1.4);
      return p;
    }
    case 'kilt': {
      const b = 29 * bw;
      p.poly([-W - 4, 0, W + 4, 0, b, 44, -b, 44], d.pri, 2.2);
      for (let i = 1; i < 7; i++) p.line([(-W - 4) + ((W * 2 + 8) * i) / 7, 2, -b + (b * 2 * i) / 7, 43], 1.1, 0.6);
      p.holes(-b + 5, 38, b - 5, 38, 7, 1.3);
      p.poly([-8, 0, 8, 0, 9, 50, 0, 57, -9, 50], d.sec, 1.9).holes(0, 10, 0, 44, 4, 1.4);
      return p;
    }
    case 'loincloth':
      p.poly([-12, 0, 12, 0, 14, 40, 0, 51, -14, 40], d.pri, 2).line([-9, 34, 0, 43, 9, 34], 1.2, 0.7).holes(0, 8, 0, 32, 3, 1.5);
      return p;
    case 'greaves':
      p.poly([-W - 4, 0, W + 4, 0, W + 7, 26, 0, 34, -W - 7, 26], d.acc, 2).holes(-W, 20, W, 20, 5, 1.3);
      return p;
    case 'trousers':
      p.poly([-W - 2, 0, W + 2, 0, W, 10, 0, 17, -W, 10], darken(d.pri, 0.25), 1.8);
      return p;
  }
}

// --- Limbs ----------------------------------------------------------------------------------------

export function drawThigh(look: PuppetLook, bw: number): Part {
  const d = dyes(look);
  const p = new Part('thigh');
  const w0 = 22 * bw;
  const w1 = 17 * bw;
  const L = DIM.thigh;
  if (look.bottom === 'trousers') {
    p.capsule(L, w0 + 2, w1 + 2, d.pri).line([0, 8, 0, L - 6], 1, 0.45);
  } else {
    p.capsule(L, w0, w1, d.skin);
    if (look.bottom === 'greaves') p.poly([-w0 / 2 - 1, 6, w0 / 2 + 1, 6, w1 / 2 + 1.5, 44, -w1 / 2 - 1.5, 44], d.acc, 1.6).holes(0, 14, 0, 38, 3, 1.3);
    if (look.bottom === 'dhoti') {
      p.poly([-w0 / 2 - 4, -5, w0 / 2 + 4, -5, w0 / 2 + 9, 49, 1, 58, -w0 / 2 - 8, 52], d.pri, 2.1);
      p.line([-4, -2, -6, 50], 1, 0.5).line([4, -2, 6, 49], 1, 0.5);
      p.poly([-w0 / 2 - 7, 44, w0 / 2 + 8, 41, w0 / 2 + 9, 49, 1, 58, -w0 / 2 - 8, 52], d.sec, 1.4).holes(-w0 / 2 - 2, 49, w0 / 2 + 3, 47, 4, 1.3);
    }
  }
  rivet(p);
  return p;
}

export function drawShin(look: PuppetLook, bw: number): Part {
  const d = dyes(look);
  const p = new Part('shin');
  const w0 = 16 * bw;
  const w1 = 11 * bw;
  const L = DIM.shin;
  const boot = look.bottom === 'trousers' ? darken(d.pri, 0.5) : d.skin;
  if (look.bottom === 'trousers') {
    p.capsule(L, w0 + 1.5, w1 + 2, d.pri);
    p.poly([-w1 / 2 - 2.5, L - 22, w1 / 2 + 3, L - 22, w1 / 2 + 2, L, -w1 / 2 - 2, L], boot, 1.6);
  } else {
    p.capsule(L, w0, w1, d.skin);
    if (look.bottom === 'greaves') {
      p.poly([-w0 / 2 - 1.5, 5, w0 / 2 + 1.5, 5, w1 / 2 + 2, L - 5, -w1 / 2 - 2, L - 5], d.acc, 1.7);
      p.line([-w0 / 2, 18, w0 / 2, 18], 1, 0.6).line([-w1 / 2 - 1, 36, w1 / 2 + 1, 36], 1, 0.6);
    } else if (look.jewelry > 0) p.band(L - 12, w1 / 2 + 2.2, 5.5, d.acc);
  }
  p.poly([-6 * bw, L - 3, 8, L - 4, 22, L + 3, 23, L + DIM.foot, -7 * bw, L + DIM.foot], boot, 2);
  rivet(p);
  return p;
}

export function drawUpperArm(look: PuppetLook, bw: number, plain: boolean): Part {
  const d = dyes(look);
  const p = new Part('upperarm');
  const w0 = 15 * bw;
  const w1 = 12 * bw;
  const L = DIM.upper;
  const top = plain ? 'bare' : look.top;
  p.capsule(L, w0, w1, top === 'robe' ? d.pri : d.skin);
  if (top === 'tunic') p.poly([-w0 / 2 - 1.5, -3, w0 / 2 + 1.5, -3, w0 / 2 + 2, 22, -w0 / 2 - 2, 22], d.pri, 1.8).holes(-w0 / 2 + 2, 18, w0 / 2 - 2, 18, 3, 1.2);
  if (top === 'armor') p.ellipse(0, 3, w0 / 2 + 6, 10, d.acc, 1.9).holes(-w0 / 2, 6, w0 / 2, 6, 3, 1.3);
  if (top !== 'robe' && top !== 'tunic' && look.jewelry > 0) p.band(17, w0 / 2 + 1.6, 6, d.acc).hole(0, 20, 1.3);
  rivet(p);
  return p;
}

export function drawForearm(look: PuppetLook, bw: number, plain: boolean): Part {
  const d = dyes(look);
  const p = new Part('forearm');
  const w0 = 12 * bw;
  const w1 = 9 * bw;
  const L = DIM.fore;
  const top = plain ? 'bare' : look.top;
  p.capsule(L, w0, w1, d.skin);
  if (top === 'robe') p.poly([-w0 / 2 - 2, -2, w0 / 2 + 2, -2, w1 / 2 + 8, L - 8, -w1 / 2 - 8, L - 8], d.pri, 1.9).holes(-w1 / 2 - 4, L - 12, w1 / 2 + 4, L - 12, 4, 1.2);
  else if (top === 'armor') p.poly([-w0 / 2 - 1.5, 14, w0 / 2 + 1.5, 14, w1 / 2 + 1.8, L - 4, -w1 / 2 - 1.8, L - 4], d.acc, 1.7).line([-w0 / 2, 24, w0 / 2, 24], 1, 0.6);
  else if (look.jewelry > 0) p.band(L - 10, w1 / 2 + 2, 5.5, d.acc);
  p.circle(0, L + DIM.hand, 6.4 * Math.sqrt(bw), d.skin, 1.9);
  rivet(p);
  return p;
}

// --- Extras ---------------------------------------------------------------------------------------

export function drawCape(look: PuppetLook, bw: number): Part {
  const d = dyes(look);
  const p = new Part('cape');
  const S = 30 * bw;
  p.poly([-S, 0, S, 0, S + 10, 60, S + 16, 118, S - 6, 132, 4, 124, -20, 136, -S - 22, 116, -S - 10, 58], d.sec, 2.4);
  p.line([-S * 0.4, 6, -S - 4, 118], 1.1, 0.45).line([S * 0.3, 6, S + 2, 120], 1.1, 0.45).line([0, 6, -6, 124], 1.1, 0.45);
  p.holes(-S - 14, 108, S + 8, 112, 9, 1.5);
  p.circle(-S + 6, 3, 5, d.acc, 1.5).circle(S - 6, 3, 5, d.acc, 1.5);
  return p;
}

export function drawTail(look: PuppetLook): Part {
  const d = dyes(look);
  const p = new Part('tail');
  const centre = [...quad(0, 0, -44, 18, -62, -18, 10), ...quad(-62, -18, -76, -52, -52, -70, 8).slice(2)];
  p.poly(ribbon(centre, (t) => 10 - 4 * t), d.skin, 2.2);
  p.circle(-50, -72, 8, darken(d.skin, 0.2), 1.8);
  return p;
}

export function drawWings(look: PuppetLook): Part {
  const d = dyes(look);
  const p = new Part('wings');
  p.poly([-8, -6, -72, -64, -60, -34, -92, -30, -66, -8, -90, 14, -58, 16, -70, 42, -38, 30, -16, 36], d.sec, 2.3);
  p.line([-12, -4, -66, -50], 1.1, 0.5).line([-14, 2, -80, -22], 1.1, 0.5).line([-14, 10, -78, 14], 1.1, 0.5).line([-14, 18, -60, 36], 1.1, 0.5);
  p.holes(-24, -10, -24, 26, 5, 1.5);
  return p;
}

// --- Weapons --------------------------------------------------------------------------------------

export interface WeaponParts {
  part: Part;
  /** Bow strings: one at rest, one drawn back. */
  stringRest?: Graphics;
  stringDrawn?: Graphics;
}

/** Drawn with the grip at the origin and the business end toward -y. */
export function drawWeapon(weapon: Weapon, look: PuppetLook): WeaponParts {
  const d = dyes(look);
  const p = new Part(`weapon:${weapon}`);
  const steel = STEEL;
  switch (weapon) {
    case 'bow': {
      p.poly(ribbon([...quad(0, -74, 30, -40, 20, 0, 9), ...quad(20, 0, 30, 40, 0, 74, 9).slice(2)], (t) => 4.5 + 3.5 * Math.sin(t * Math.PI)), WOOD, 2);
      p.poly([14, -10, 25, -10, 25, 10, 14, 10], d.acc, 1.5).holes(19.5, -5, 19.5, 5, 2, 1.2);
      p.circle(0, -74, 3.2, d.acc, 1.3).circle(0, 74, 3.2, d.acc, 1.3);
      const rest = new Graphics().moveTo(0, -74).lineTo(0, 74).stroke({ color: INK, width: 1.4, alpha: 0.9 });
      const drawn = new Graphics().moveTo(0, -74).lineTo(-30, 0).lineTo(0, 74).stroke({ color: INK, width: 1.4, alpha: 0.9 });
      drawn.poly([-30, -1.6, 34, -1.6, 44, 0, 34, 1.6, -30, 1.6]).fill({ color: INK, alpha: 0.9 });
      drawn.visible = false;
      p.c.addChild(rest, drawn);
      return { part: p, stringRest: rest, stringDrawn: drawn };
    }
    case 'mace':
      p.poly([-3.5, -72, 3.5, -72, 3.5, 30, -3.5, 30], d.acc, 1.8).circle(0, 33, 5, d.acc, 1.5);
      p.circle(0, -92, 23, lighten(d.acc, 0.05), 2.4);
      // Ribs of the gada's head.
      p.line(arc(0, -92, 9, 23, -Math.PI / 2, Math.PI / 2, 10), 1.2, 0.65).line(arc(0, -92, 9, 23, Math.PI / 2, Math.PI * 1.5, 10), 1.2, 0.65);
      p.line([0, -115, 0, -69], 1.2, 0.65);
      p.poly([-5, -113, 5, -113, 0, -128], d.acc, 1.6).holes(-12, -92, 12, -92, 5, 1.6).poly([-7, -72, 7, -72, 9, -66, -9, -66], d.sec, 1.4);
      break;
    case 'hammer':
      p.poly([-3.5, -66, 3.5, -66, 3.5, 26, -3.5, 26], WOOD, 1.8).poly([-4.5, 4, 4.5, 4, 4.5, 26, -4.5, 26], darken(WOOD, 0.3), 1.3).circle(0, 30, 4.5, d.acc, 1.4);
      p.poly([-26, -96, 26, -96, 29, -90, 29, -70, 26, -64, -26, -64, -29, -70, -29, -90], steel, 2.4);
      p.line([-17, -95, -17, -65], 1.2, 0.6).line([17, -95, 17, -65], 1.2, 0.6).holes(-9, -80, 9, -80, 3, 1.8);
      break;
    case 'sword':
      p.poly([-5.5, -12, 5.5, -12, 6.5, -78, 1, -100, -4.5, -80], steel, 2).line([0, -14, 1, -92], 1, 0.5);
      p.poly([-15, -16, 15, -16, 13, -9, -13, -9], d.acc, 1.7).poly([-3, -9, 3, -9, 3, 12, -3, 12], darken(WOOD, 0.35), 1.4).circle(0, 15, 4.5, d.acc, 1.4);
      break;
    case 'spear':
      p.poly([-2.6, -122, 2.6, -122, 2.6, 62, -2.6, 62], WOOD, 1.7);
      p.poly([0, -156, 8.5, -128, 0, -114, -8.5, -128], steel, 2).line([0, -152, 0, -118], 1, 0.5);
      p.poly([-5, -114, 5, -114, 8, -98, 0, -104, -8, -98], d.sec, 1.4);
      break;
    case 'trident':
      p.poly([-2.8, -118, 2.8, -118, 2.8, 62, -2.8, 62], d.acc, 1.7);
      p.poly([0, -160, 5.5, -132, -5.5, -132], steel, 1.8);
      p.poly(ribbon(quad(0, -122, 18, -124, 17, -152), (t) => 7 - 4.5 * t), steel, 1.8).poly(ribbon(quad(0, -122, -18, -124, -17, -152), (t) => 7 - 4.5 * t), steel, 1.8);
      p.poly([-9, -126, 9, -126, 7, -116, -7, -116], d.acc, 1.5).holes(-4, -121, 4, -121, 2, 1.2);
      break;
    case 'staff':
      p.poly([-3.2, -112, 3.2, -112, 3.2, 62, -3.2, 62], d.sec, 1.8);
      p.poly([-5, -124, 5, -124, 5, -100, -5, -100], d.acc, 1.6).poly([-5, 44, 5, 44, 5, 66, -5, 66], d.acc, 1.6);
      p.circle(0, -131, 7.5, d.acc, 1.8).hole(0, -131, 2).holes(0, -118, 0, -106, 2, 1.2);
      break;
    case 'chakra':
      p.g.star(0, -24, 16, 26, 20).fill({ color: d.acc, alpha: 0.94 });
      p.g.star(0, -24, 16, 26, 20).stroke({ color: INK, width: 1.8, alpha: 0.95, join: 'round' });
      p.h.circle(0, -24, 9).fill({ color: HOLE, alpha: 1 });
      p.h.circle(0, -24, 9).stroke({ color: INK, width: 1.6, alpha: 0.9 });
      for (let i = 0; i < 8; i++) p.hole(Math.cos((i / 8) * Math.PI * 2) * 14.5, -24 + Math.sin((i / 8) * Math.PI * 2) * 14.5, 1.3);
      break;
    case 'axe':
      p.poly([-3.2, -84, 3.2, -84, 3.2, 30, -3.2, 30], WOOD, 1.8).circle(0, 33, 4.5, d.acc, 1.4);
      p.poly([3, -88, 22, -102, 36, -78, 24, -52, 3, -62], steel, 2.2).line([8, -84, 26, -78, 8, -66], 1.1, 0.5);
      p.poly([-3, -84, -16, -78, -3, -68], steel, 1.7);
      break;
    case 'fists':
      p.poly([-7.5, -3, 7.5, -3, 7.5, 5, -7.5, 5], d.acc, 1.5).holes(-4, 1, 4, 1, 3, 1.1);
      break;
  }
  return { part: p };
}
