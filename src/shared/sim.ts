// The duel itself: a fixed-step, deterministic simulation with no rendering and no I/O. A local
// match runs it in the browser; an online match runs the same class on the server.
import {
  ARENA_HALF, CROUCH_H, EFFECT_SECONDS, EMPTY_PROMPT_COST, FIGHTER_H, FIGHTER_HALF_W, GRAVITY, HAND_Y,
  INTRO_SECONDS, JUMP_SPEED, LINGER_INTERVAL, LINGER_SHARES, MANTRA_MAX, MATCH_SECONDS, MIN_GAP,
  PROMPT_SECONDS, RESOLVE_SECONDS, SIM_DT, SLOWMO_SCALE, STAMINA_DELAY, STAMINA_MAX, derive, type Derived,
} from './balance';
import {
  BEAM, BURST, MELEE, PROJECTILE_RADIUS, WAVE, beamSpan, burstRadius, effectLife, meleeReach, projectileAt, waveX,
  type EffectState,
} from './effects';
import type { Anim, CharacterSheet, Element, MoveSpec } from './types';
import { clamp } from './util';

/** Input bit flags. One number per player per step keeps the wire format tiny. */
export const KEY = { left: 1, right: 2, up: 4, down: 8, base: 16, special: 32 } as const;

export type Act = 'idle' | 'walk' | 'jump' | 'crouch' | 'attack' | 'cast' | 'hit' | 'ko' | 'win';
/** 0 none, 1 typing, 2 waiting for the AI. */
export type PromptPhase = 0 | 1 | 2;

export interface StatusState {
  name: string;
  element: Element;
  color: string;
  from: 0 | 1;
  /** Damage of each tick still to come. */
  ticks: number[];
  /** Simulation time of the next tick. */
  next: number;
}

export interface FighterState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  crouch: boolean;
  hp: number;
  maxHp: number;
  stamina: number;
  mantra: number;
  /** The prompt button stays locked until the mantra bar is full again. */
  locked: boolean;
  act: Act;
  actT: number;
  anim: Anim;
  /** Which move the current attack is: 0 base, 1 special, 2 prompt. */
  slot: 0 | 1 | 2;
  cd: [number, number];
  stun: number;
  prompt: PromptPhase;
  /** Real seconds left to type, or to wait for the AI. */
  promptT: number;
  statuses: StatusState[];
  lastMove: string;
  dealt: number;
  prompts: number;
}

export interface MatchState {
  /** Simulation seconds since the fight began. Slow motion makes it run slower than the wall clock. */
  t: number;
  phase: 'intro' | 'fight' | 'over';
  intro: number;
  clock: number;
  scale: number;
  fighters: [FighterState, FighterState];
  effects: EffectState[];
  /** -1 undecided, 0 or 1 a winner, 2 a draw. */
  winner: -1 | 0 | 1 | 2;
  reason: '' | 'ko' | 'time' | 'forfeit';
}

export type SimEvent =
  | { type: 'start' }
  | { type: 'cast'; who: 0 | 1; slot: 0 | 1 | 2; move: MoveSpec }
  | { type: 'hit'; who: 0 | 1; dmg: number; x: number; y: number; element: Element; heavy: boolean }
  | { type: 'block'; who: 0 | 1; x: number; y: number; element: Element }
  | { type: 'afflict'; who: 0 | 1; element: Element; name: string }
  | { type: 'tick'; who: 0 | 1; dmg: number; element: Element }
  | { type: 'prompt'; who: 0 | 1; phase: 'open' | 'submit' | 'timeout' }
  | { type: 'fizzle'; who: 0 | 1 }
  | { type: 'jump'; who: 0 | 1 }
  | { type: 'land'; who: 0 | 1 }
  | { type: 'ko'; who: 0 | 1 }
  | { type: 'end'; winner: 0 | 1 | 2; reason: 'ko' | 'time' | 'forfeit' };

/** Seconds before the effect leaves the hand, and the whole length of the animation. */
export const ANIM_TIMING: Record<Anim, { windup: number; total: number }> = {
  shoot: { windup: 0.16, total: 0.42 },
  swing: { windup: 0.14, total: 0.44 },
  throw: { windup: 0.15, total: 0.42 },
  cast: { windup: 0.2, total: 0.5 },
  thrust: { windup: 0.1, total: 0.36 },
  slam: { windup: 0.2, total: 0.52 },
  guard: { windup: 0, total: 0.4 },
};

function attackLength(move: MoveSpec): number {
  const t = ANIM_TIMING[move.anim].total;
  return move.delivery === 'beam' && move.kind === 'attack' ? Math.max(t, ANIM_TIMING[move.anim].windup + BEAM.end - 0.1) : t;
}

function newFighter(x: number, facing: 1 | -1, d: Derived): FighterState {
  return {
    x, y: 0, vx: 0, vy: 0, facing, grounded: true, crouch: false,
    hp: d.maxHp, maxHp: d.maxHp, stamina: STAMINA_MAX, mantra: MANTRA_MAX, locked: false,
    act: 'idle', actT: 0, anim: 'swing', slot: 0, cd: [0, 0], stun: 0,
    prompt: 0, promptT: 0, statuses: [], lastMove: '', dealt: 0, prompts: 0,
  };
}

type Approach = 'side' | 'above';

export class Match {
  readonly state: MatchState;
  readonly sheets: [CharacterSheet, CharacterSheet];
  private readonly derived: [Derived, Derived];
  private readonly pending: [MoveSpec | null, MoveSpec | null] = [null, null];
  private readonly staminaWait: [number, number] = [0, 0];
  private events: SimEvent[] = [];
  private nextId = 1;

  constructor(sheets: [CharacterSheet, CharacterSheet], private readonly seed: number) {
    this.sheets = sheets;
    this.derived = [derive(sheets[0]), derive(sheets[1])];
    this.state = {
      t: 0, phase: 'intro', intro: INTRO_SECONDS, clock: MATCH_SECONDS, scale: 1,
      fighters: [newFighter(-4, 1, this.derived[0]), newFighter(4, -1, this.derived[1])],
      effects: [], winner: -1, reason: '',
    };
  }

  /** Events since the last call, for sound, sparks and damage numbers. */
  drain(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Advances by one fixed step of real time. `keys` holds each player's KEY flags. */
  step(keys: [number, number], realDt: number = SIM_DT): void {
    const s = this.state;
    if (s.phase === 'intro') {
      s.intro -= realDt;
      if (s.intro <= 0) {
        s.intro = 0;
        s.phase = 'fight';
        this.events.push({ type: 'start' });
      }
      return;
    }
    if (s.phase === 'over') {
      s.scale = 1;
      s.t += realDt;
      for (const i of [0, 1] as const) {
        const f = s.fighters[i];
        f.actT += realDt;
        this.integrate(i, realDt);
      }
      this.updateEffects(false);
      return;
    }

    for (const i of [0, 1] as const) {
      const f = s.fighters[i];
      if (f.prompt === 0) continue;
      f.promptT -= realDt;
      if (f.prompt === 1 && f.promptT <= 0 && f.promptT + realDt > 0) this.events.push({ type: 'prompt', who: i, phase: 'timeout' });
      // The controller normally answers a timeout at once; these keep a stuck controller from freezing time.
      if (f.prompt === 1 && f.promptT < -1.2) this.cancelPrompt(i);
      else if (f.prompt === 2 && f.promptT < -1.5) this.resolvePrompt(i, null);
    }

    s.scale = s.fighters[0].prompt !== 0 || s.fighters[1].prompt !== 0 ? SLOWMO_SCALE : 1;
    const dt = realDt * s.scale;
    s.t += dt;
    // Slow motion changes the world, never the real two-minute match limit.
    s.clock = Math.max(0, s.clock - realDt);

    for (const i of [0, 1] as const) this.updateFighter(i, keys[i], dt);
    this.separate();
    for (const i of [0, 1] as const) {
      const f = s.fighters[i];
      const o = s.fighters[1 - i]!;
      if (f.act !== 'attack' && f.act !== 'ko' && Math.abs(o.x - f.x) > 0.05) f.facing = o.x > f.x ? 1 : -1;
    }
    this.updateEffects(true);
    this.updateStatuses();
    this.checkEnd();
  }

  // --- Prompts ------------------------------------------------------------------------------------

  canPrompt(i: 0 | 1): boolean {
    const f = this.state.fighters[i];
    return this.state.phase === 'fight' && f.act !== 'ko' && f.prompt === 0 && !f.locked;
  }

  /** Slows time and gives the player PROMPT_SECONDS to type. */
  openPrompt(i: 0 | 1): boolean {
    if (!this.canPrompt(i)) return false;
    const f = this.state.fighters[i];
    f.prompt = 1;
    f.promptT = PROMPT_SECONDS;
    this.events.push({ type: 'prompt', who: i, phase: 'open' });
    return true;
  }

  /** The text is on its way to the AI. Time stays slow until `resolvePrompt` is called. */
  submitPrompt(i: 0 | 1): boolean {
    const f = this.state.fighters[i];
    if (f.prompt !== 1) return false;
    f.prompt = 2;
    f.promptT = RESOLVE_SECONDS;
    this.events.push({ type: 'prompt', who: i, phase: 'submit' });
    return true;
  }

  /** Nothing was typed, or the prompt was refused: a small cost, and the lock. */
  cancelPrompt(i: 0 | 1): void {
    const f = this.state.fighters[i];
    if (f.prompt === 0) return;
    f.prompt = 0;
    f.promptT = 0;
    f.mantra = Math.max(0, f.mantra - EMPTY_PROMPT_COST);
    f.locked = true;
    this.events.push({ type: 'fizzle', who: i });
  }

  /** Applies what the AI made of the prompt. The move already carries its cost and damage. */
  resolvePrompt(i: 0 | 1, move: MoveSpec | null): void {
    const s = this.state;
    const f = s.fighters[i];
    if (f.prompt === 0) return;
    if (!move || s.phase !== 'fight' || f.act === 'ko') {
      this.cancelPrompt(i);
      return;
    }
    f.prompt = 0;
    f.promptT = 0;
    f.mantra = Math.max(0, f.mantra - clamp(move.cost, 0, MANTRA_MAX));
    f.locked = true;
    f.prompts += 1;
    const scaled: MoveSpec = move.kind === 'attack' ? { ...move, damage: move.damage * this.derived[i].promptDamage } : { ...move, damage: 0 };
    // A prompt is the "save me" button: it breaks stun and cannot be interrupted.
    f.stun = 0;
    f.act = 'cast';
    f.actT = 0;
    f.anim = scaled.kind === 'defense' ? 'guard' : scaled.anim;
    f.slot = 2;
    f.lastMove = scaled.name;
    this.pending[i] = null;
    this.events.push({ type: 'cast', who: i, slot: 2, move: scaled });
    this.spawn(i, scaled, true);
  }

  forfeit(i: 0 | 1): void {
    if (this.state.phase === 'over') return;
    this.finish((1 - i) as 0 | 1, 'forfeit');
  }

  // --- Fighters -----------------------------------------------------------------------------------

  private updateFighter(i: 0 | 1, keys: number, dt: number): void {
    const s = this.state;
    const f = s.fighters[i];
    const d = this.derived[i];
    f.actT += dt;
    f.cd[0] = Math.max(0, f.cd[0] - dt);
    f.cd[1] = Math.max(0, f.cd[1] - dt);
    this.staminaWait[i] = Math.max(0, this.staminaWait[i] - dt);
    if (this.staminaWait[i] === 0) f.stamina = Math.min(STAMINA_MAX, f.stamina + d.staminaRegen * dt);
    if (f.locked) {
      f.mantra += d.mantraRegen * dt;
      if (f.mantra >= MANTRA_MAX) {
        f.mantra = MANTRA_MAX;
        f.locked = false;
      }
    }
    if (f.act === 'ko') {
      this.integrate(i, dt);
      return;
    }

    if (f.stun > 0) {
      f.stun = Math.max(0, f.stun - dt);
      f.vx *= Math.max(0, 1 - 7 * dt);
      if (f.stun === 0 && f.act === 'hit') this.setAct(f, 'idle');
    } else if (f.act === 'attack' || f.act === 'cast') {
      const move = this.pending[i];
      if (move && f.actT >= ANIM_TIMING[f.anim].windup) {
        this.pending[i] = null;
        this.spawn(i, move, false);
      }
      const total = f.act === 'cast' ? ANIM_TIMING[f.anim].total : this.attackTotal[i];
      if (f.grounded) f.vx = 0;
      if (f.actT >= total) this.setAct(f, 'idle');
    }

    const free = f.stun === 0 && f.act !== 'attack' && f.act !== 'cast';
    if (free) {
      const dir = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
      if (f.grounded) {
        f.crouch = (keys & KEY.down) !== 0;
        f.vx = f.crouch ? 0 : dir * d.moveSpeed;
        if (keys & KEY.up && !f.crouch) {
          f.vy = JUMP_SPEED;
          f.grounded = false;
          this.events.push({ type: 'jump', who: i });
        }
      } else {
        f.crouch = false;
        f.vx += (dir * d.moveSpeed * 0.85 - f.vx) * Math.min(1, 8 * dt);
      }
      if (keys & KEY.base) this.tryMove(i, 0);
      else if (keys & KEY.special) this.tryMove(i, 1);
    }

    this.integrate(i, dt);

    if (f.stun === 0 && f.act !== 'attack' && f.act !== 'cast') {
      const next: Act = !f.grounded ? 'jump' : f.crouch ? 'crouch' : Math.abs(f.vx) > 0.2 ? 'walk' : 'idle';
      if (next !== f.act) this.setAct(f, next);
    }
  }

  private attackTotal: [number, number] = [0.4, 0.4];

  private setAct(f: FighterState, act: Act): void {
    f.act = act;
    f.actT = 0;
  }

  private integrate(i: 0 | 1, dt: number): void {
    const f = this.state.fighters[i];
    if (!f.grounded) f.vy -= GRAVITY * dt;
    f.x = clamp(f.x + f.vx * dt, -ARENA_HALF, ARENA_HALF);
    f.y += f.vy * dt;
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      if (!f.grounded) {
        f.grounded = true;
        this.events.push({ type: 'land', who: i });
      }
    }
    if (f.act === 'ko' || f.act === 'win') f.vx *= Math.max(0, 1 - 5 * dt);
  }

  private tryMove(i: 0 | 1, slot: 0 | 1): void {
    const f = this.state.fighters[i];
    const d = this.derived[i];
    const move = slot === 0 ? this.sheets[i].moves.base : this.sheets[i].moves.special;
    if (f.cd[slot] > 0 || f.stamina < move.cost) return;
    f.stamina -= move.cost;
    this.staminaWait[i] = STAMINA_DELAY;
    f.cd[slot] = move.cooldown * d.cooldown;
    const scaled: MoveSpec = { ...move, damage: move.damage * (slot === 0 ? d.baseDamage : d.specialDamage) };
    f.act = 'attack';
    f.actT = 0;
    f.anim = scaled.anim;
    f.slot = slot;
    f.crouch = false;
    f.lastMove = scaled.name;
    this.attackTotal[i] = attackLength(scaled);
    this.pending[i] = scaled;
    this.events.push({ type: 'cast', who: i, slot, move: scaled });
  }

  private separate(): void {
    const [a, b] = this.state.fighters;
    if (a.act === 'ko' || b.act === 'ko') return;
    if (Math.abs(a.y - b.y) > FIGHTER_H * 0.6) return;
    const gap = b.x - a.x;
    const dist = Math.abs(gap);
    if (dist >= MIN_GAP) return;
    const push = (MIN_GAP - dist) / 2;
    const sign = gap >= 0 ? 1 : -1;
    a.x = clamp(a.x - sign * push, -ARENA_HALF, ARENA_HALF);
    b.x = clamp(b.x + sign * push, -ARENA_HALF, ARENA_HALF);
  }

  // --- Effects ------------------------------------------------------------------------------------

  private spawn(i: 0 | 1, move: MoveSpec, prompt: boolean): void {
    const s = this.state;
    const f = s.fighters[i];
    const o = s.fighters[1 - i]!;
    const id = this.nextId++;
    const counted = move.kind === 'attack' && (move.delivery === 'projectile' || move.delivery === 'rain');
    s.effects.push({
      id, owner: i, move, t0: s.t,
      ox: f.x + f.facing * 0.6, oy: f.y + (f.crouch ? 0.95 : HAND_Y), cx: f.x,
      tx: o.x, ty: o.y + (o.crouch ? 0.7 : 1.45), dir: f.facing,
      seed: (this.seed + id * 7919) | 0,
      used: counted ? new Array<number>(clamp(Math.round(move.count), 1, 50)).fill(0) : [],
      done: false, ticks: 0, afflicted: false, prompt,
    });
  }

  private hurtbox(f: FighterState): { x0: number; x1: number; y0: number; y1: number } {
    return { x0: f.x - FIGHTER_HALF_W, x1: f.x + FIGHTER_HALF_W, y0: f.y, y1: f.y + (f.crouch ? CROUCH_H : FIGHTER_H) };
  }

  private updateEffects(live: boolean): void {
    const s = this.state;
    for (const e of s.effects) {
      if (!live || e.move.kind === 'defense') continue;
      const age = s.t - e.t0;
      const target = s.fighters[1 - e.owner]!;
      if (target.act === 'ko') continue;
      const box = this.hurtbox(target);
      const m = e.move;
      switch (m.delivery) {
        case 'projectile':
        case 'rain': {
          const per = m.damage / e.used.length;
          for (let k = 0; k < e.used.length; k++) {
            if (e.used[k] !== 0) continue;
            const p = projectileAt(e, k, age);
            if (!p.live) continue;
            const r = PROJECTILE_RADIUS;
            if (p.x < box.x0 - r || p.x > box.x1 + r || p.y < box.y0 - r || p.y > box.y1 + r) continue;
            const hit = this.strike(e, per, m.delivery === 'rain' ? 'above' : 'side', p.x, p.x, clamp(p.y, box.y0, box.y1));
            e.used[k] = hit ? 1 : 2;
          }
          break;
        }
        case 'beam': {
          while (e.ticks < BEAM.ticks && age >= BEAM.firstTick + e.ticks * BEAM.tickEvery) {
            e.ticks += 1;
            const b = beamSpan(e, BEAM.firstTick + (e.ticks - 1) * BEAM.tickEvery);
            const lo = Math.min(b.x0, b.x1);
            const hi = Math.max(b.x0, b.x1);
            if (box.x1 < lo || box.x0 > hi || box.y1 < b.y - b.half || box.y0 > b.y + b.half) continue;
            this.strike(e, m.damage / BEAM.ticks, 'side', e.ox, target.x - e.dir * FIGHTER_HALF_W, b.y);
          }
          break;
        }
        case 'wave': {
          if (e.done) break;
          const w = waveX(e, age);
          if (!w.active) break;
          if (Math.abs(target.x - w.x) <= WAVE.half + FIGHTER_HALF_W && target.y < WAVE.height * 0.9) {
            e.done = true;
            this.strike(e, m.damage, 'side', w.x - e.dir, w.x, 0.6);
          }
          break;
        }
        case 'burst': {
          if (e.done) break;
          const b = burstRadius(e, age);
          if (!b.active) break;
          if (Math.abs(target.x - e.cx) <= b.r + FIGHTER_HALF_W && target.y < b.r) {
            e.done = true;
            this.strike(e, m.damage, 'side', e.cx, target.x, target.y + 1.3);
          }
          break;
        }
        case 'melee': {
          if (e.done || age > MELEE.active) break;
          const reach = meleeReach(m);
          const lo = Math.min(e.cx, e.cx + e.dir * reach);
          const hi = Math.max(e.cx, e.cx + e.dir * reach);
          if (box.x1 >= lo && box.x0 <= hi && box.y0 < e.oy - HAND_Y + MELEE.height) {
            e.done = true;
            this.strike(e, m.damage, 'side', e.cx, target.x - e.dir * 0.2, clamp(e.oy, box.y0, box.y1));
          }
          break;
        }
      }
    }
    s.effects = s.effects.filter((e) => s.t - e.t0 < effectLife(e.move));
  }

  /** The opponent's shield that stops an attack arriving this way, if any. */
  private shieldAgainst(victim: 0 | 1, approach: Approach, srcX: number): EffectState | undefined {
    const s = this.state;
    const f = s.fighters[victim];
    for (const e of s.effects) {
      if (e.owner !== victim || e.move.kind !== 'defense' || s.t - e.t0 >= EFFECT_SECONDS) continue;
      const form = e.move.shieldForm;
      if (form === 'dome') return e;
      if (form === 'canopy' && approach === 'above') return e;
      if (form === 'wall' && approach === 'side' && (srcX >= f.x ? 1 : -1) === e.dir) return e;
    }
    return undefined;
  }

  /** One hit attempt. Returns false when a shield stopped it. */
  private strike(e: EffectState, dmg: number, approach: Approach, srcX: number, x: number, y: number): boolean {
    const victim = (1 - e.owner) as 0 | 1;
    const m = e.move;
    if (this.shieldAgainst(victim, approach, srcX)) {
      this.events.push({ type: 'block', who: victim, x, y, element: m.element });
      return false;
    }
    if (m.mode === 'lingering') {
      // The whole budget arrives as decaying ticks, once, however many projectiles connect.
      if (!e.afflicted) {
        e.afflicted = true;
        this.state.fighters[victim].statuses.push({
          name: m.name, element: m.element, color: m.color, from: e.owner,
          ticks: LINGER_SHARES.map((share) => m.damage * share), next: this.state.t,
        });
        this.events.push({ type: 'afflict', who: victim, element: m.element, name: m.name });
      }
      this.events.push({ type: 'hit', who: victim, dmg: 0, x, y, element: m.element, heavy: false });
      return true;
    }
    this.damage(victim, e.owner, dmg, x, y, m.element, dmg >= 2);
    return true;
  }

  private damage(victim: 0 | 1, from: 0 | 1, dmg: number, x: number, y: number, element: Element, heavy: boolean): void {
    const s = this.state;
    const f = s.fighters[victim];
    if (f.act === 'ko' || s.phase !== 'fight') return;
    const dealt = Math.min(f.hp, dmg);
    f.hp -= dealt;
    s.fighters[from].dealt += dealt;
    this.events.push({ type: 'hit', who: victim, dmg, x, y, element, heavy });
    if (f.hp <= 0.0001) {
      f.hp = 0;
      return;
    }
    if (heavy && f.act !== 'cast') {
      f.stun = Math.max(f.stun, Math.min(0.28, 0.1 + dmg * 0.02));
      const away = f.x >= s.fighters[from].x ? 1 : -1;
      f.vx = away * Math.min(5, 1.5 + dmg * 0.4);
      this.pending[victim] = null;
      f.act = 'hit';
      f.actT = 0;
    }
  }

  private updateStatuses(): void {
    const s = this.state;
    for (const i of [0, 1] as const) {
      const f = s.fighters[i];
      if (f.statuses.length === 0) continue;
      for (const st of f.statuses) {
        while (st.ticks.length > 0 && s.t >= st.next) {
          const dmg = st.ticks.shift()!;
          st.next += LINGER_INTERVAL;
          this.events.push({ type: 'tick', who: i, dmg, element: st.element });
          this.damage(i, st.from, dmg, f.x, f.y + 1.6, st.element, false);
        }
      }
      f.statuses = f.statuses.filter((st) => st.ticks.length > 0);
    }
  }

  // --- Ending -------------------------------------------------------------------------------------

  private checkEnd(): void {
    const s = this.state;
    const [a, b] = s.fighters;
    const aDown = a.hp <= 0;
    const bDown = b.hp <= 0;
    if (aDown || bDown) {
      this.finish(aDown && bDown ? 2 : aDown ? 1 : 0, 'ko');
      return;
    }
    if (s.clock <= 0) this.finish(Math.abs(a.hp - b.hp) < 0.05 ? 2 : a.hp > b.hp ? 0 : 1, 'time');
  }

  private finish(winner: 0 | 1 | 2, reason: 'ko' | 'time' | 'forfeit'): void {
    const s = this.state;
    if (s.phase === 'over') return;
    s.phase = 'over';
    s.winner = winner;
    s.reason = reason;
    s.scale = 1;
    for (const i of [0, 1] as const) {
      const f = s.fighters[i];
      f.prompt = 0;
      f.promptT = 0;
      f.stun = 0;
      f.statuses = [];
      this.pending[i] = null;
      // The loser falls. In a draw only a fighter who was actually struck down falls.
      const falls = winner === 2 ? f.hp <= 0 : winner !== i;
      f.act = falls ? 'ko' : winner === i ? 'win' : 'idle';
      f.actT = 0;
      if (falls) this.events.push({ type: 'ko', who: i });
    }
    this.events.push({ type: 'end', winner, reason });
  }
}

/** Remaining mantra lock in seconds, for the HUD. */
export function lockSeconds(f: FighterState, mantraRegen: number): number {
  return f.locked ? (MANTRA_MAX - f.mantra) / mantraRegen : 0;
}
