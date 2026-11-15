// The Mythic Strings server: one Node process that serves the built client, the JSON API and the
// online-duel WebSocket. It keeps no secrets in responses and validates everything it is sent.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { WebSocketServer } from 'ws';
import { levelForWins, ratingForLevel } from '../shared/balance';
import { buildCustom, type ForgeInput } from '../shared/designer';
import { ROSTER } from '../shared/roster';
import type { ProgressUpdate } from '../shared/types';
import { str, uid } from '../shared/util';
import { activeProviders, aiUsage, recentErrors } from './ai/llm';
import { sanitizeSvg } from './ai/svg';
import { atelier, chronicle, decodeSketch, narrate, resolveMantra, summon } from './ai/tasks';
import { aiStatus, config } from './config';
import { guestSession, owns, originAllowed } from './auth';
import { clientIp } from './client-ip';
import { Rooms, loadSheet } from './rooms';
import { createStore } from './store';
import { FileStore } from './store/file';

const VERSION = '1.0.0';
const MAX_CUSTOMS = 12;
const store = createStore();
const rooms = new Rooms(store);
const startedAt = Date.now();

// --- Small HTTP helpers ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' });
  res.end(text);
}

function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'That request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const parsed: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'The request body must be a JSON object.'));
      }
    });
    req.on('error', reject);
  });
}

/** Sliding one-minute window per client and bucket. */
class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  allow(key: string, perMinute: number): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (list.length >= perMinute) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.every((t) => now - t >= 60_000)) this.hits.delete(k);
    return true;
  }
}
const limiter = new RateLimiter();

function limit(req: IncomingMessage, bucket: string, perMinute: number): void {
  if (!limiter.allow(`${bucket}:${clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], config.trustProxy)}`, perMinute)) throw new HttpError(429, 'Too many requests. Wait a moment and try again.');
}

function ownerId(value: unknown, req: IncomingMessage): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{6,64}$/.test(value)) throw new HttpError(400, 'A valid player id is required.');
  if (!owns(req, value)) throw new HttpError(401, 'Your guest session has expired. Reload the page to reconnect.');
  return value;
}

// --- API ------------------------------------------------------------------------------------------

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const route = `${req.method} ${url.pathname}`;
  limit(req, 'api', 600);

  switch (route) {
    case 'POST /api/session': {
      limit(req, 'session', 30);
      const body = await readJson(req, 2000);
      return json(res, 200, guestSession(body.id, body.token));
    }
    case 'GET /api/health': {
      const ai = aiStatus();
      return json(res, 200, {
        ok: true, version: VERSION, uptime: Math.round((Date.now() - startedAt) / 1000), ai, providers: activeProviders(),
        models: {
          ...(ai.gemini ? { gemini: [config.gemini.fastModel, config.gemini.smartModel] } : {}),
          ...(ai.bedrock ? { bedrock: [config.bedrock.fastModel, config.bedrock.smartModel] } : {}),
        },
        store: store.kind, rooms: rooms.count(), usage: aiUsage(), aiErrors: recentErrors().map((e) => ({ provider: e.provider, at: e.at })),
      });
    }

    case 'GET /api/roster': {
      const summoned = await store.listLegends(40);
      return json(res, 200, { legends: ROSTER, summoned });
    }

    case 'POST /api/summon': {
      limit(req, 'ai', config.aiPerMinute);
      const body = await readJson(req, 4_000);
      const out = await summon(String(body.name ?? ''), store);
      return json(res, out.ok ? 200 : 422, out);
    }

    case 'POST /api/prompt': {
      limit(req, 'ai', config.aiPerMinute);
      const body = await readJson(req, 4_000);
      const typedMs = Math.max(0, Math.min(8000, Number(body.typedMs) || 0));
      return json(res, 200, await resolveMantra(String(body.text ?? ''), typedMs));
    }

    case 'POST /api/atelier': {
      limit(req, 'ai', Math.max(6, Math.floor(config.aiPerMinute / 3)));
      const body = await readJson(req, 2_200_000);
      const palette = Array.isArray(body.palette) ? body.palette.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4) : [];
      const sketch = body.sketch ? decodeSketch(body.sketch) : null;
      if (body.sketch && !sketch) throw new HttpError(400, 'The sketch must be a PNG, JPEG or WebP image under 1 MB.');
      const out = await atelier(body.slot, body.text, sketch, palette);
      return json(res, out.ok ? 200 : 422, out);
    }

    case 'POST /api/narrate': {
      limit(req, 'ai', config.aiPerMinute);
      const body = await readJson(req, 4_000);
      const owner = body.owner ? ownerId(body.owner, req) : '';
      const picks = Array.isArray(body.picks) ? body.picks.slice(0, 2) : [];
      const sheets = await Promise.all(
        picks.map((p) => {
          const o = (p ?? {}) as { id?: unknown; custom?: unknown };
          return loadSheet(store, { id: str(o.id, '', 64), custom: o.custom === true }, owner);
        }),
      );
      if (sheets.length !== 2 || !sheets[0] || !sheets[1]) throw new HttpError(400, 'Two known characters are required.');
      return json(res, 200, await narrate(sheets[0], sheets[1], owner || null));
    }

    case 'GET /api/characters': {
      const owner = ownerId(url.searchParams.get('owner'), req);
      return json(res, 200, { characters: await store.listCustoms(owner) });
    }

    case 'POST /api/characters': {
      limit(req, 'write', 30);
      const body = await readJson(req, 400_000);
      const owner = ownerId(body.owner, req);
      const input = (body.input ?? {}) as ForgeInput;
      const name = str(input.name, '', 24);
      if (name.length < 2) throw new HttpError(400, 'Give your character a name of at least two letters.');
      const existingId = typeof input.id === 'string' && /^[a-z0-9]{6,40}$/.test(input.id) ? input.id : '';
      const existing = existingId ? await store.getCustom(owner, existingId) : null;
      if (!existing && (await store.listCustoms(owner)).length >= MAX_CUSTOMS) {
        throw new HttpError(409, `You can keep up to ${MAX_CUSTOMS} characters. Delete one to forge another.`);
      }
      // Wins always come from the stored record, never from the client.
      const sheet = buildCustom(input, owner, existing?.id ?? uid('c'), existing?.wins ?? 0, sanitizeSvg);
      if (existing?.createdAt) sheet.createdAt = existing.createdAt;
      await store.putCustom(sheet);
      return json(res, 200, { sheet });
    }

    case 'DELETE /api/characters': {
      limit(req, 'write', 30);
      const owner = ownerId(url.searchParams.get('owner'), req);
      await store.deleteCustom(owner, str(url.searchParams.get('id'), '', 64));
      return json(res, 200, { ok: true });
    }

    case 'POST /api/match': {
      // Result of a duel played on one machine. Trusted as reported, so it is rate limited.
      limit(req, 'match', 6);
      const body = await readJson(req, 8_000);
      const owner = ownerId(body.owner, req);
      const winner = body.winner === 0 || body.winner === 1 ? body.winner : 2;
      const picks = (Array.isArray(body.picks) ? body.picks.slice(0, 2) : []).map((p) => {
        const o = (p ?? {}) as { id?: unknown; custom?: unknown; name?: unknown };
        return { id: str(o.id, '', 64), custom: o.custom === true, name: str(o.name, 'Fighter', 40) };
      });
      if (picks.length !== 2) throw new HttpError(400, 'Two fighters are required.');
      const progress: ProgressUpdate[] = [];
      const won = winner === 2 ? null : picks[winner]!;
      if (won?.custom && body.versus !== 'cpu') {
        const before = await store.getCustom(owner, won.id);
        const wins = before ? await store.addWin(owner, won.id) : null;
        if (before && wins !== null) {
          const level = levelForWins(wins);
          progress.push({ characterId: won.id, wins, level, rating: ratingForLevel(level), leveledUp: level > levelForWins(before.wins ?? 0) });
        }
      }
      const hp = Array.isArray(body.hp) ? body.hp.slice(0, 2).map((v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)))) : [0, 0];
      await store.putMatch({
        id: uid('m'), at: Date.now(), mode: 'local', fighters: [picks[0]!.name, picks[1]!.name], players: ['Player 1', body.versus === 'cpu' ? 'CPU' : 'Player 2'],
        winner, reason: str(body.reason, 'ko', 12), hp: [hp[0] ?? 0, hp[1] ?? 0],
      });
      chronicle(owner, `${picks[0]!.name} ${winner === 0 ? 'defeated' : winner === 1 ? 'was defeated by' : 'drew with'} ${picks[1]!.name} in a local duel.`);
      return json(res, 200, { progress });
    }

    case 'GET /api/matches':
      return json(res, 200, { matches: await store.listMatches(12) });
  }
  throw new HttpError(404, 'No such endpoint.');
}

// --- Static files ---------------------------------------------------------------------------------

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.map', '.txt']);
const gzCache = new Map<string, { mtime: number; body: Buffer }>();

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(config.staticDir, path.normalize(rel));
  // Anything that is not a real file is the single-page app.
  if (!file.startsWith(config.staticDir + path.sep) || !existsSync(file) || !statSync(file).isFile()) file = path.join(config.staticDir, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('The client has not been built yet. Run "npm run build", or use "npm run dev" and open http://127.0.0.1:5173.');
    return;
  }
  const ext = path.extname(file);
  const stat = statSync(file);
  const hashed = file.includes(`${path.sep}assets${path.sep}`);
  const headers: Record<string, string | number> = {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  };
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  if (acceptsGzip && COMPRESSIBLE.has(ext) && stat.size > 1024 && stat.size < 8_000_000) {
    let entry = gzCache.get(file);
    if (!entry || entry.mtime !== stat.mtimeMs) {
      entry = { mtime: stat.mtimeMs, body: gzipSync(readFileSync(file)) };
      gzCache.set(file, entry);
    }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': entry.body.length, Vary: 'Accept-Encoding' });
    res.end(req.method === 'HEAD' ? undefined : entry.body);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

// --- Server ---------------------------------------------------------------------------------------

const server = createServer((req, res) => {
  if (!originAllowed(req)) { res.writeHead(403); res.end('Use the public theatre URL.'); return; }
  let url: URL;
  try { url = new URL(req.url ?? '/', 'http://localhost'); }
  catch { res.writeHead(400); res.end('Malformed URL.'); return; }
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((err: unknown) => {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return json(res, err.status, { ok: false, error: err.message });
      console.error(`[api] ${req.method} ${url.pathname}`, err);
      json(res, 500, { ok: false, error: 'Something went wrong on the server.' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  try {
    serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('[static]', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
wss.on('connection', (ws) => rooms.handle(ws));

server.on('upgrade', (req, socket, head) => {
  if (!originAllowed(req)) { socket.destroy(); return; }
  let pathname: string;
  try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; }
  catch { socket.destroy(); return; }
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// Drop connections that have silently died (closed laptops, lost Wi-Fi).
const alive = new WeakSet<object>();
wss.on('connection', (ws) => {
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 25_000);
heartbeat.unref();

server.listen(config.port, config.host, () => {
  const ai = aiStatus();
  console.log(`[mythic-strings] v${VERSION} listening on http://${config.host}:${config.port}`);
  console.log(
    `[mythic-strings] AI: gemini ${ai.gemini ? 'on' : 'off'}, bedrock ${ai.bedrock ? 'on' : 'off'}, supermemory ${ai.memory ? 'on' : 'off'}` +
      (activeProviders().length === 0 ? ' (no provider: the built-in reader and lore book are used)' : ''),
  );
});

function shutdown(signal: string): void {
  console.log(`[mythic-strings] ${signal}: shutting down`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'server restarting');
  if (store instanceof FileStore) store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
