// Online duels. Each room holds two seats and runs the authoritative simulation at 60 Hz, sending
// both players a snapshot 30 times a second. Clients only ever send their key flags and their mantra
// text, so nothing a client says can change HP, cooldowns or positions directly.
import type { WebSocket } from 'ws';
import { PROMPT_SECONDS, SIM_DT, levelForWins, ratingForLevel } from '../shared/balance';
import { verdictOf, type ClientMsg, type LobbyPlayer, type Pick, type ServerMsg } from '../shared/protocol';
import { findBuiltin } from '../shared/roster';
import { Match, type SimEvent } from '../shared/sim';
import type { CharacterSheet, PlayerProfile, ProgressUpdate } from '../shared/types';
import { str, uid } from '../shared/util';
import { chronicle, resolveMantra } from './ai/tasks';
import type { Store } from './store';
import { validSession } from './auth';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STEP_MS = SIM_DT * 1000;
const ROOM_IDLE_MS = 20 * 60 * 1000;
const MAX_ROOMS = 200;

interface Seat {
  ws: WebSocket;
  player: PlayerProfile;
  pick: Pick;
  sheet: CharacterSheet;
  keys: number;
  rematch: boolean;
  inputAt: number;
}

interface Room {
  code: string;
  seats: [Seat | null, Seat | null];
  match: Match | null;
  timer: NodeJS.Timeout | null;
  last: number;
  acc: number;
  frame: number;
  sentFrame: number;
  events: SimEvent[];
  finished: boolean;
  overFrames: number;
  touched: number;
  completion: Promise<void> | null;
  restarting: boolean;
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export async function loadSheet(store: Store, pick: Pick, ownerId: string): Promise<CharacterSheet | null> {
  if (pick.custom) return store.getCustom(ownerId, pick.id);
  const known = findBuiltin(pick.id) ?? (await store.getLegend(pick.id));
  if (known) return known;
  return null;
}

function validPlayer(p: unknown): PlayerProfile | null {
  const o = p as Partial<PlayerProfile> | null;
  if (!o || typeof o.id !== 'string' || !/^[a-zA-Z0-9_-]{6,64}$/.test(o.id)) return null;
  return { id: o.id, name: str(o.name, 'Player', 20) };
}

function validPick(p: unknown): Pick | null {
  const o = p as Partial<Pick> | null;
  if (!o || typeof o.id !== 'string' || o.id.length < 1 || o.id.length > 64) return null;
  return { id: o.id, custom: o.custom === true };
}

export class Rooms {
  private readonly rooms = new Map<string, Room>();
  private readonly sweep: NodeJS.Timeout;

  constructor(private readonly store: Store) {
    this.sweep = setInterval(() => this.sweepIdle(), 60_000);
    this.sweep.unref();
  }

  count(): number {
    return this.rooms.size;
  }

  /** Wires up one WebSocket connection. */
  handle(ws: WebSocket): void {
    let room: Room | null = null;
    let seat: 0 | 1 = 0;
    let busy = false;
    let windowStart = Date.now();
    let inWindow = 0;

    const leave = () => {
      if (!room) return;
      const r = room;
      room = null;
      this.vacate(r, seat);
    };

    ws.on('message', (raw) => {
      // A well-behaved client sends at most a few dozen messages a second.
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        inWindow = 0;
      }
      if (++inWindow > 200) return;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;

      switch (msg.t) {
        case 'ping':
          send(ws, { t: 'pong', at: Number(msg.at) || 0 });
          return;
        case 'create':
        case 'join': {
          if (room || busy) return;
          const player = validPlayer(msg.player);
          const pick = validPick(msg.pick);
          if (!player || !pick) return send(ws, { t: 'error', message: 'That request was not understood.' });
          if (!validSession(player.id, msg.token)) return send(ws, { t: 'error', message: 'Your guest session expired. Reload and try again.' });
          const code = msg.t === 'join' ? String(msg.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '';
          busy = true;
          void loadSheet(this.store, pick, player.id)
            .then((sheet) => {
              busy = false;
              if (ws.readyState !== ws.OPEN) return;
              if (!sheet) return send(ws, { t: 'error', message: 'That character could not be found. Pick it again.' });
              const s: Seat = { ws, player, pick, sheet, keys: 0, rematch: false, inputAt: performance.now() };
              if (msg.t === 'create') {
                if (this.rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', message: 'The theatre is full. Try again in a minute.' });
                room = this.create(s);
                seat = 0;
              } else {
                const target = this.rooms.get(code);
                if (!target) return send(ws, { t: 'error', message: `No duel with the code ${code || '?'} is waiting.` });
                if (target.seats[1] || target.match) return send(ws, { t: 'error', message: 'That duel already has two players.' });
                target.seats[1] = s;
                room = target;
                seat = 1;
                this.announce(target);
                setTimeout(() => this.start(target), 900);
              }
            })
            .catch((err) => {
              busy = false;
              console.error('[rooms] load failed', err);
              send(ws, { t: 'error', message: 'The server could not load that character.' });
            });
          return;
        }
        case 'leave':
          leave();
          return;
      }

      const r = room;
      const me = r?.seats[seat];
      if (!r || !me) return;
      r.touched = now;
      const match = r.match;
      switch (msg.t) {
        case 'in':
          me.keys = (Number(msg.k) | 0) & 63;
          me.inputAt = performance.now();
          break;
        case 'popen':
          match?.openPrompt(seat);
          break;
        case 'pcancel':
          match?.cancelPrompt(seat);
          break;
        case 'psubmit': {
          if (!match) break;
          const f = match.state.fighters[seat];
          const typedMs = Math.round((PROMPT_SECONDS - Math.max(0, f.promptT)) * 1000);
          const text = str(msg.text, '', 80);
          if (!match.submitPrompt(seat)) break;
          if (!text) {
            match.cancelPrompt(seat);
            break;
          }
          const who = seat;
          void resolveMantra(text, typedMs).then((result) => {
            if (r.match !== match) return;
            match.resolvePrompt(who, result.ok ? result.move : null);
            this.broadcast(r, { t: 'verdict', v: verdictOf(who, text, result) });
          });
          break;
        }
        case 'rematch':
          if (!match || match.state.phase !== 'over') break;
          me.rematch = true;
          this.broadcast(r, { t: 'rematch', ready: [r.seats[0]?.rematch === true, r.seats[1]?.rematch === true] });
          if (r.seats[0]?.rematch && r.seats[1]?.rematch) void this.restart(r);
          break;
      }
    });

    ws.on('close', leave);
    ws.on('error', leave);
  }

  private create(s: Seat): Room {
    let code = '';
    do {
      code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room: Room = {
      code, seats: [s, null], match: null, timer: null, last: 0, acc: 0, frame: 0, sentFrame: 0, events: [], finished: false, overFrames: 0,
      touched: Date.now(), completion: null, restarting: false,
    };
    this.rooms.set(code, room);
    this.announce(room);
    return room;
  }

  private announce(room: Room): void {
    const players: (LobbyPlayer | null)[] = room.seats.map((s) => (s ? { name: s.player.name, character: s.sheet.name, rating: s.sheet.rating } : null));
    room.seats.forEach((s, i) => s && send(s.ws, { t: 'room', code: room.code, you: i as 0 | 1, players }));
  }

  private broadcast(room: Room, msg: ServerMsg): void {
    const text = JSON.stringify(msg);
    for (const s of room.seats) if (s && s.ws.readyState === s.ws.OPEN) s.ws.send(text);
  }

  private start(room: Room): void {
    const [a, b] = room.seats;
    if (!a || !b || room.match) return;
    this.stop(room);
    room.match = new Match([a.sheet, b.sheet], (Math.random() * 0x7fffffff) | 0);
    room.finished = false;
    room.overFrames = 0;
    room.events = [];
    room.frame = 0;
    room.sentFrame = 0;
    room.acc = 0;
    room.last = performance.now();
    a.keys = b.keys = 0;
    a.rematch = b.rematch = false;
    send(a.ws, { t: 'start', sheets: [a.sheet, b.sheet], you: 0 });
    send(b.ws, { t: 'start', sheets: [a.sheet, b.sheet], you: 1 });
    room.timer = setInterval(() => this.tick(room), 1000 / 60);
  }

  private async restart(room: Room): Promise<void> {
    if (room.restarting) return;
    room.restarting = true;
    try {
      // Wait for the winning counter before loading sheets for the new duel.
      await room.completion;
      for (const s of room.seats) {
        if (!s) return;
        s.sheet = (await loadSheet(this.store, s.pick, s.player.id)) ?? s.sheet;
      }
      room.match = null;
      this.start(room);
    } finally { room.restarting = false; }
  }

  private stop(room: Room): void {
    if (room.timer) clearInterval(room.timer);
    room.timer = null;
  }

  private tick(room: Room): void {
    const match = room.match;
    const [a, b] = room.seats;
    if (!match || !a || !b) return this.stop(room);
    const now = performance.now();
    const elapsed = now - room.last;
    if (match.state.phase === 'fight' && elapsed > 250) match.state.clock = Math.max(0, match.state.clock - (elapsed - 250) / 1000);
    room.acc = Math.min(250, room.acc + elapsed);
    room.last = now;
    // A backgrounded or disconnected tab cannot keep an attack key held indefinitely.
    if (now - a.inputAt > 1000) a.keys = 0;
    if (now - b.inputAt > 1000) b.keys = 0;
    while (room.acc >= STEP_MS) {
      room.acc -= STEP_MS;
      match.step([match.state.fighters[0].prompt ? 0 : a.keys, match.state.fighters[1].prompt ? 0 : b.keys]);
      room.frame++;
      const events = match.drain();
      if (events.length) room.events.push(...events);
      if (match.state.phase === 'over') {
        room.overFrames++;
        if (!room.finished) {
          room.finished = true;
          room.completion = this.finish(room, match);
        }
      }
    }
    if (room.frame - room.sentFrame >= 2) {
      room.sentFrame = room.frame;
      this.broadcast(room, { t: 's', s: match.state, ev: room.events });
      room.events = [];
    }
    // Keep sending for a few seconds after the end so the fall and the victory pose play out.
    if (room.overFrames > 60 * 6) this.stop(room);
  }

  private async finish(room: Room, match: Match): Promise<void> {
    const s = match.state;
    const winner = (s.winner === -1 ? 2 : s.winner) as 0 | 1 | 2;
    const progress: ProgressUpdate[] = [];
    const [a, b] = room.seats;
    try {
      if (winner !== 2) {
        const w = room.seats[winner];
        if (w && w.pick.custom) {
          const before = levelForWins(w.sheet.wins ?? 0);
          const wins = await this.store.addWin(w.player.id, w.pick.id);
          if (wins !== null) {
            const level = levelForWins(wins);
            progress.push({ characterId: w.pick.id, wins, level, rating: ratingForLevel(level), leveledUp: level > before });
          }
        }
      }
      if (a && b) {
        await this.store.putMatch({
          id: uid('m'), at: Date.now(), mode: 'online', fighters: [a.sheet.name, b.sheet.name], players: [a.player.name, b.player.name],
          winner, reason: s.reason, hp: [Math.round(s.fighters[0].hp), Math.round(s.fighters[1].hp)],
        });
        const line = (me: Seat, foe: Seat, won: boolean | null) =>
          `${me.player.name}, playing ${me.sheet.name}, ${won === null ? 'drew with' : won ? 'defeated' : 'was defeated by'} ${foe.sheet.name} (${foe.player.name}) by ${s.reason === 'ko' ? 'knockout' : s.reason}.`;
        chronicle(a.player.id, line(a, b, winner === 2 ? null : winner === 0));
        chronicle(b.player.id, line(b, a, winner === 2 ? null : winner === 1));
      }
    } catch (err) {
      console.error('[rooms] could not record the result', err);
    }
    this.broadcast(room, { t: 'end', winner, reason: s.reason, progress });
  }

  private vacate(room: Room, seat: 0 | 1): void {
    const match = room.match;
    if (match && match.state.phase !== 'over') {
      match.forfeit(seat);
      this.broadcast(room, { t: 's', s: match.state, ev: match.drain() });
    }
    room.seats[seat] = null;
    const other = room.seats[1 - seat];
    if (other) {
      // Let the forfeit reach the remaining player, then close the room.
      if (match && !room.finished) {
        room.finished = true;
        room.completion = this.finish(room, match).then(() => send(other.ws, { t: 'left' }));
      } else send(other.ws, { t: 'left' });
    }
    this.stop(room);
    this.rooms.delete(room.code);
  }

  private sweepIdle(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (now - room.touched < ROOM_IDLE_MS) continue;
      this.stop(room);
      for (const s of room.seats) if (s) send(s.ws, { t: 'left' });
      this.rooms.delete(room.code);
    }
  }
}
