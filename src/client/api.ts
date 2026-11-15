import type { ForgeInput } from '../shared/designer';
import type { Pick } from '../shared/protocol';
import type { CharacterSheet, PlayerProfile, ProgressUpdate, ResolvedPrompt, Slot, SvgAsset } from '../shared/types';
import { uid } from '../shared/util';

export interface Health {
  ok: boolean;
  ai: { gemini: boolean; bedrock: boolean; memory: boolean };
  providers: string[];
  store: string;
}

let accessToken = readSaved<string>('session', '');
export const sessionToken = (): string => accessToken;

export async function request<T>(route: string, body?: unknown, method?: string, timeout = 35_000): Promise<T> {
  const response = await fetch('/api/' + route, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json().catch(() => null) as (Record<string, unknown> | null);
  if (!response.ok || !data) throw new Error(String(data?.error ?? data?.reason ?? 'The theatre could not be reached. Please try again.'));
  return data as T;
}

export async function establishSession(player: PlayerProfile): Promise<void> {
  const out = await request<{ id: string; token: string }>('session', { id: player.id, token: accessToken }, undefined, 5000);
  player.id = out.id;
  accessToken = out.token;
  save('player', player);
  save('session', accessToken);
}

export function readSaved<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem('mythic.' + key) ?? 'null') as T ?? fallback; }
  catch { return fallback; }
}

export function save(key: string, value: unknown): void {
  try { localStorage.setItem('mythic.' + key, JSON.stringify(value)); } catch { /* Private browsing may disable storage. */ }
}

export function playerProfile(): PlayerProfile {
  const stored = readSaved<Partial<PlayerProfile>>('player', {});
  const profile = {
    id: typeof stored.id === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(stored.id) ? stored.id : uid('p'),
    name: typeof stored.name === 'string' ? stored.name.slice(0, 20) : 'Puppeteer',
  };
  save('player', profile);
  return profile;
}

export const pickOf = (sheet: CharacterSheet): Pick => ({ id: sheet.id, custom: sheet.kind === 'custom' });

export const api = {
  health: () => request<Health>('health', undefined, undefined, 5000),
  roster: () => request<{ legends: CharacterSheet[]; summoned: CharacterSheet[] }>('roster'),
  characters: (owner: string) => request<{ characters: CharacterSheet[] }>('characters?owner=' + encodeURIComponent(owner)),
  forge: (owner: string, input: ForgeInput) => request<{ sheet: CharacterSheet }>('characters', { owner, input }),
  delete: (owner: string, id: string) => request<{ ok: boolean }>('characters?owner=' + encodeURIComponent(owner) + '&id=' + encodeURIComponent(id), undefined, 'DELETE'),
  summon: (name: string) => request<{ ok: boolean; sheet: CharacterSheet; cached: boolean }>('summon', { name }),
  prompt: (text: string, typedMs: number) => request<ResolvedPrompt>('prompt', { text, typedMs }, undefined, 3400),
  atelier: (slot: Slot, text: string, sketch: string | null, palette: string[]) =>
    request<{ ok: boolean; asset: SvgAsset; source: string }>('atelier', { slot, text, sketch, palette }, undefined, 34_000),
  narrate: (owner: string, sheets: [CharacterSheet, CharacterSheet]) =>
    request<{ line: string; source: string }>('narrate', { owner, picks: sheets.map(pickOf) }, undefined, 4200),
  result: (body: unknown) => request<{ progress: ProgressUpdate[] }>('match', body),
};
