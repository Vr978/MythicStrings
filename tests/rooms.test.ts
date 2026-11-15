import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { WebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';
import { KEY } from '../src/shared/sim';
import { buildCustom } from '../src/shared/designer';
import { FileStore } from '../src/server/store/file';
import { Rooms } from '../src/server/rooms';

// Ownership itself is covered by the HTTP/browser suite. These tests isolate room timing and results.
vi.mock('../src/server/auth', () => ({ validSession: () => true }));

class Socket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  messages: ServerMsg[] = [];
  send(raw: string): void { this.messages.push(JSON.parse(raw) as ServerMsg); }
  input(message: ClientMsg): void { this.emit('message', Buffer.from(JSON.stringify(message))); }
}

describe('authoritative rooms', () => {
  it('records a win once and reloads the new rank before a single mutually requested rematch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    const dir = mkdtempSync(path.join(tmpdir(), 'mythic-rooms-'));
    const store = new FileStore(dir);
    const rooms = new Rooms(store);
    const a = new Socket(), b = new Socket();
    try {
      const sheet = buildCustom({ name: 'Rising Archer', weapon: 'bow' }, 'playerone', 'customone', 2);
      await store.putCustom(sheet);
      rooms.handle(a as unknown as WebSocket);
      rooms.handle(b as unknown as WebSocket);
      a.input({ t: 'create', player: { id: 'playerone', name: 'One' }, token: 'fixture', pick: { id: sheet.id, custom: true } });
      await vi.advanceTimersByTimeAsync(0);
      const lobby = a.messages.find(m => m.t === 'room');
      expect(lobby?.t).toBe('room');
      if (lobby?.t !== 'room') throw new Error('No room');
      b.input({ t: 'join', code: lobby.code, player: { id: 'playertwo', name: 'Two' }, token: 'fixture', pick: { id: 'thor', custom: false } });
      await vi.advanceTimersByTimeAsync(4100);
      const held = setInterval(() => a.input({ t: 'in', k: KEY.base }), 200);
      await vi.advanceTimersByTimeAsync(60_000);
      clearInterval(held);
      const ends = a.messages.filter(m => m.t === 'end');
      expect(ends).toHaveLength(1);
      expect(ends[0]).toMatchObject({ t: 'end', winner: 0, reason: 'ko', progress: [{ wins: 3, level: 2, rating: 64 }] });
      a.input({ t: 'rematch' });
      b.input({ t: 'rematch' });
      b.input({ t: 'rematch' });
      await vi.advanceTimersByTimeAsync(0);
      const starts = a.messages.filter(m => m.t === 'start');
      expect(starts).toHaveLength(2);
      const latest = starts.at(-1);
      if (latest?.t !== 'start') throw new Error('No rematch');
      expect(latest.sheets[0].rating).toBe(64);
      expect((await store.getCustom('playerone', sheet.id))?.wins).toBe(3);
    } finally {
      a.emit('close'); b.emit('close');
      await vi.advanceTimersByTimeAsync(0);
      vi.clearAllTimers();
      vi.useRealTimers();
      store.flush();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('times out at two real minutes and creates only two player seats', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    const dir = mkdtempSync(path.join(tmpdir(), 'mythic-rooms-'));
    const store = new FileStore(dir);
    const rooms = new Rooms(store);
    const a = new Socket(), b = new Socket(), c = new Socket();
    try {
      for (const socket of [a, b, c]) rooms.handle(socket as unknown as WebSocket);
      a.input({ t: 'create', player: { id: 'playerone', name: 'One' }, token: 'fixture', pick: { id: 'arjuna', custom: false } });
      await vi.advanceTimersByTimeAsync(0);
      const lobby = a.messages.find(m => m.t === 'room');
      if (lobby?.t !== 'room') throw new Error('No room');
      b.input({ t: 'join', code: lobby.code, player: { id: 'playertwo', name: 'Two' }, token: 'fixture', pick: { id: 'thor', custom: false } });
      await vi.advanceTimersByTimeAsync(1000);
      c.input({ t: 'join', code: lobby.code, player: { id: 'playerthree', name: 'Three' }, token: 'fixture', pick: { id: 'thor', custom: false } });
      await vi.advanceTimersByTimeAsync(0);
      expect(c.messages.some(m => m.t === 'error')).toBe(true);
      await vi.advanceTimersByTimeAsync(124_000);
      expect(a.messages.find(m => m.t === 'end')).toMatchObject({ winner: 0, reason: 'time' });
      expect(c.messages.some(m => m.t === 'start')).toBe(false);
    } finally {
      a.emit('close'); b.emit('close'); c.emit('close');
      await vi.advanceTimersByTimeAsync(0);
      vi.clearAllTimers(); vi.useRealTimers();
      store.flush(); rmSync(dir, { recursive: true, force: true });
    }
  });
});
