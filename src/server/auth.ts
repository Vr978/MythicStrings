import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { config } from './config';

/** Persisted independently of releases so a redeploy does not invalidate browser collections. */
function signingKey(): Buffer {
  if (config.sessionSecret) return Buffer.from(config.sessionSecret, 'utf8');
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(config.dataDir, 'session.key');
  if (!existsSync(file)) {
    try { writeFileSync(file, randomBytes(48), { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (!existsSync(file)) throw error; }
  }
  return readFileSync(file);
}
const key = signingKey();
const mac = (id: string): string => createHmac('sha256', key).update('mythic-guest-v1:' + id).digest('base64url');

export function equalSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function validSession(id: unknown, token: unknown): boolean {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(id) && typeof token === 'string' && equalSecret(token, mac(id));
}

export function guestSession(id: unknown, token: unknown): { id: string; token: string } {
  const owner = validSession(id, token) ? id as string : 'p' + randomBytes(18).toString('hex');
  return { id: owner, token: mac(owner) };
}

export function owns(req: IncomingMessage, id: unknown): boolean {
  const header = req.headers.authorization ?? '';
  return validSession(id, header.startsWith('Bearer ') ? header.slice(7) : '');
}

export function originAllowed(req: IncomingMessage): boolean {
  return !config.originSecret || equalSecret(String(req.headers['x-mythic-origin'] ?? ''), config.originSecret);
}
