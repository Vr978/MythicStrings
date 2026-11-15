import { Container, Graphics, Text } from 'pixi.js';
import { beamSpan, burstRadius, meleeReach, projectileAt, rainHalfWidth, waveX } from '../../shared/effects';
import type { MatchState, SimEvent } from '../../shared/sim';
import type { Shape } from '../../shared/types';
import { clamp, hash01, hexToInt } from '../../shared/util';
import { arc, HOLE, INK } from './draw';
import { PPM, sx, sy } from './stage';

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; total: number; color: number; size: number;
}
interface FloatLabel { text: Text; life: number; total: number; }

/** Every visible attack follows the very same geometry used to register collisions. */
export class Effects {
  readonly root = new Container();
  private readonly art = new Graphics();
  private readonly sparks = new Graphics();
  private particles: Particle[] = [];
  private labels: FloatLabel[] = [];

  constructor() { this.root.addChild(this.art, this.sparks); }

  private shape(shape: Shape, x: number, y: number, r: number, a: number, color: number, seed: number): void {
    const g = this.art;
    const ca = Math.cos(a), sa = Math.sin(a);
    const point = (px: number, py: number): [number, number] => [x + ca * px - sa * py, y + sa * px + ca * py];
    const poly = (points: number[], fill = color): void => {
      const out: number[] = [];
      for (let i = 0; i < points.length; i += 2) out.push(...point(points[i] * r, points[i + 1] * r));
      g.poly(out).fill({ color: fill, alpha: 0.95 }).stroke({ color: INK, width: 1.8, join: 'round' });
    };
    switch (shape) {
      case 'arrow':
      case 'spear':
        poly([-1.5, -0.045, 0.8, -0.045, 0.8, -0.2, 1.3, 0, 0.8, 0.2, 0.8, 0.045, -1.5, 0.045]);
        poly([-1.2, 0, -1.5, -0.2, -0.9, -0.2, -0.7, 0], 0xb82f1d);
        break;
      case 'blade':
      case 'shard':
      case 'feather':
        poly([-1, -0.1, 0.9, -0.18, 1.6, 0, 0.6, 0.24, -1, 0.1]);
        break;
      case 'hammer':
        poly([-0.9, -0.07, 0.5, -0.07, 0.5, 0.07, -0.9, 0.07], 0x9e6337);
        poly([0.15, -0.55, 0.9, -0.55, 0.9, 0.55, 0.15, 0.55]);
        break;
      case 'bolt': {
        const p: number[] = [];
        for (let i = 0; i < 8; i++) p.push(...point((i / 7 - 0.5) * r * 3, (hash01(seed, i) - 0.5) * r * 0.8));
        g.poly(p, false).stroke({ color, width: 7, alpha: 0.35 });
        g.poly(p, false).stroke({ color: 0xfff9cb, width: 2.6 });
        break;
      }
      case 'serpent':
      case 'flame': {
        const p: number[] = [];
        for (let i = 0; i < 10; i++) p.push(...point((i / 9 - 0.6) * r * 2.8, Math.sin(i * 0.8) * r * 0.23));
        g.poly(p, false).stroke({ color: INK, width: 9, cap: 'round' });
        g.poly(p, false).stroke({ color, width: 5.5, cap: 'round' });
        break;
      }
      case 'star':
      case 'lotus':
      case 'disc': {
        const points: number[] = [];
        for (let i = 0; i < 16; i++) {
          const angle = i * Math.PI / 8;
          const radius = i % 2 ? 0.5 : 1;
          points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        poly(points);
        g.circle(x, y, r * 0.2).fill(HOLE);
        break;
      }
      case 'rock':
        poly([-0.7, -0.4, -0.1, -0.7, 0.65, -0.4, 0.8, 0.3, 0.1, 0.7, -0.7, 0.3]);
        break;
      case 'skull':
      case 'fist':
      case 'orb':
        g.circle(x, y, r * 0.75).fill({ color, alpha: 0.9 }).stroke({ color: INK, width: 2.2 });
        g.circle(x - r * 0.18, y - r * 0.2, r * 0.15).fill(HOLE);
        if (shape === 'skull') g.circle(x + r * 0.3, y - r * 0.18, r * 0.16).fill(INK);
        break;
    }
  }

  update(state: MatchState, dt: number): void {
    const g = this.art;
    g.clear();
    for (const effect of state.effects) {
      const move = effect.move;
      const age = state.t - effect.t0;
      const color = hexToInt(move.color);
      if (move.kind === 'defense') {
        const f = state.fighters[effect.owner];
        const x = sx(f.x), y = sy(f.y);
        const fade = clamp((2 - age) * 5, 0, 1);
        const form = move.shieldForm;
        const wall = x + effect.dir * 68;
        const outline = form === 'wall'
          ? [wall, y, wall + effect.dir * 12, y - 110, wall, y - 278]
          : arc(x, y - (form === 'canopy' ? 175 : 0), 128, form === 'canopy' ? 130 : 290, Math.PI, 2 * Math.PI, 32);
        if (form !== 'wall') {
          g.poly(outline).fill({ color, alpha: 0.16 * fade });
        }
        g.poly(outline, false).stroke({ color: INK, width: 9, alpha: 0.65 * fade });
        g.poly(outline, false).stroke({ color, width: 5, alpha: fade });
        g.poly(outline, false).stroke({ color: HOLE, width: 1.5, alpha: fade });
        for (let i = 0; i < outline.length; i += 4) g.circle(outline[i], outline[i + 1], 3).fill({ color: HOLE, alpha: fade });
        continue;
      }
      switch (move.delivery) {
        case 'projectile':
        case 'rain': {
          if (move.delivery === 'rain' && age < 0.55) {
            g.ellipse(sx(effect.tx), sy(0) - 6, rainHalfWidth(move.count) * PPM, 14)
              .fill({ color, alpha: 0.16 + 0.1 * Math.sin(age * 35) }).stroke({ color, width: 2, alpha: 0.6 });
          }
          const count = clamp(Math.round(move.count), 1, 50);
          for (let i = 0; i < count; i++) {
            if (effect.used[i]) continue;
            const p = projectileAt(effect, i, age);
            if (!p.live) continue;
            const x = sx(p.x), y = sy(p.y);
            const size = move.shape === 'arrow' || move.shape === 'spear' ? 22 : move.shape === 'bolt' ? 28 : 19;
            if (move.element !== 'physical') {
              const tx = x - Math.cos(p.angle) * 35, ty = y + Math.sin(p.angle) * 35;
              g.moveTo(tx, ty).lineTo(x, y).stroke({ color, width: 13, alpha: 0.2 });
            }
            const rotation = move.shape === 'hammer' || move.shape === 'disc' ? age * 14 * effect.dir : -p.angle;
            this.shape(move.shape, x, y, size, rotation, color, effect.seed + i);
          }
          break;
        }
        case 'beam': {
          const b = beamSpan(effect, age);
          if (!b.active) break;
          const x0 = sx(b.x0), x1 = sx(b.x1), y = sy(b.y);
          g.moveTo(x0, y).lineTo(x1, y).stroke({ color, width: b.half * PPM * 3, alpha: 0.17 * b.strength });
          g.moveTo(x0, y).lineTo(x1, y).stroke({ color: INK, width: b.half * PPM * 2 + 4, alpha: 0.75 * b.strength });
          g.moveTo(x0, y).lineTo(x1, y).stroke({ color, width: b.half * PPM * 2, alpha: 0.9 * b.strength });
          g.moveTo(x0, y).lineTo(x1, y).stroke({ color: HOLE, width: 9 * b.strength });
          for (let i = 0; i < 7; i++) {
            const x = x0 + (x1 - x0) * hash01(effect.seed + Math.floor(age * 15), i);
            g.circle(x, y, 3).fill(HOLE);
          }
          break;
        }
        case 'wave': {
          const w = waveX(effect, age);
          if (!w.active) break;
          const x = sx(w.x), y = sy(0);
          g.poly([x - 35, y, x - effect.dir * 24, y - 55, x, y - 99, x + effect.dir * 25, y - 46, x + 35, y])
            .fill({ color, alpha: 0.82 }).stroke({ color: INK, width: 3, join: 'round' });
          for (let j = 0; j < 4; j++) g.moveTo(x - effect.dir * (j * 25), y - j * 13).lineTo(x - effect.dir * (j * 25 + 42), y - j * 13).stroke({ color, width: 4, alpha: 0.5 });
          break;
        }
        case 'burst': {
          const b = burstRadius(effect, age);
          if (b.strength <= 0) break;
          const x = sx(effect.cx), y = sy(0);
          g.poly(arc(x, y, b.r * PPM, b.r * PPM, Math.PI, 2 * Math.PI, 36), false)
            .stroke({ color, width: 14 * b.strength, alpha: 0.75 * b.strength });
          for (let j = 0; j < 8; j++) {
            const a = Math.PI + j * Math.PI / 7;
            this.shape(move.shape, x + Math.cos(a) * b.r * PPM, y + Math.sin(a) * b.r * PPM, 16, a, color, j);
          }
          break;
        }
        case 'melee': {
          const fade = clamp(1 - age / 0.42, 0, 1);
          const x = sx(effect.cx), y = sy(effect.oy);
          const reach = meleeReach(move) * PPM;
          const a = effect.dir === 1 ? -0.7 : Math.PI - 0.7;
          g.poly(arc(x, y + 35, reach, reach * 0.6, a, a + 1.3, 16), false)
            .stroke({ color, width: 20 * fade, alpha: 0.7 * fade, cap: 'round' });
          break;
        }
      }
    }
    this.sparks.clear();
    this.particles = this.particles.filter(p => {
      p.life -= dt;
      if (p.life <= 0) return false;
      p.vy += 200 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      this.sparks.circle(p.x, p.y, p.size * p.life / p.total).fill({ color: p.color, alpha: p.life / p.total });
      return true;
    });
    this.labels = this.labels.filter(label => {
      label.life -= dt;
      if (label.life <= 0) { label.text.destroy(); return false; }
      label.text.y -= 38 * dt;
      label.text.alpha = Math.min(1, label.life * 3);
      return true;
    });
  }

  event(event: SimEvent): void {
    if (event.type !== 'hit' && event.type !== 'block') return;
    const x = sx(event.x), y = sy(event.y);
    const blocked = event.type === 'block';
    if (!blocked && event.dmg === 0) return;
    const count = blocked ? 5 : event.heavy ? 9 : 4;
    for (let i = 0; i < count && this.particles.length < 160; i++) {
      const a = Math.random() * Math.PI * 2;
      const total = 0.2 + Math.random() * 0.3;
      this.particles.push({ x, y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150 - 45, life: total, total, size: 2.5 + Math.random() * 3, color: blocked ? 0xf9e6ac : 0xb6301b });
    }
    if (this.labels.length > 24 || (!blocked && event.dmg < 0.4)) return;
    const text = new Text({
      text: blocked ? 'BLOCK' : '−' + (event.dmg >= 2 ? Math.round(event.dmg) : event.dmg.toFixed(1)),
      style: { fontFamily: 'Georgia', fontSize: blocked ? 18 : event.heavy ? 30 : 23, fontWeight: 'bold', fill: blocked ? '#fff1be' : '#6e1009', stroke: { color: blocked ? '#44310b' : '#fff0bc', width: 3 } },
    });
    text.anchor.set(0.5);
    text.position.set(x + (Math.random() - 0.5) * 25, y - 28);
    this.root.addChild(text);
    this.labels.push({ text, life: 0.7, total: 0.7 });
  }

  clear(): void {
    this.art.clear(); this.sparks.clear();
    this.particles = [];
    for (const label of this.labels) label.text.destroy();
    this.labels = [];
  }
}
