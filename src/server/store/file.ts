// JSON-file store for development and single-machine demos. Writes are debounced and atomic
// (write to a temp file, then rename), so a crash never leaves a half-written file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyProgress } from '../../shared/designer';
import type { CharacterSheet } from '../../shared/types';
import type { MatchRecord, Store } from './index';

interface Shape {
  legends: Record<string, CharacterSheet>;
  customs: Record<string, Record<string, CharacterSheet>>;
  matches: MatchRecord[];
}

export class FileStore implements Store {
  readonly kind = 'file' as const;
  private readonly file: string;
  private data: Shape = { legends: {}, customs: {}, matches: [] };
  private timer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'store.json');
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Shape>;
        this.data = { legends: parsed.legends ?? {}, customs: parsed.customs ?? {}, matches: parsed.matches ?? [] };
      } catch (err) {
        console.warn(`[store] could not read ${this.file}, starting empty: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 150);
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }

  async getLegend(slug: string): Promise<CharacterSheet | null> {
    return Object.hasOwn(this.data.legends, slug) ? this.data.legends[slug]! : null;
  }

  async putLegend(slug: string, sheet: CharacterSheet): Promise<void> {
    if (this.data.legends[slug]) return;
    this.data.legends[slug] = sheet;
    this.save();
  }

  async listLegends(limit: number): Promise<CharacterSheet[]> {
    const unique = new Map<string, CharacterSheet>();
    for (const s of Object.values(this.data.legends)) unique.set(s.id, s);
    return [...unique.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, limit);
  }

  async getCustom(ownerId: string, id: string): Promise<CharacterSheet | null> {
    if (!Object.hasOwn(this.data.customs, ownerId)) return null;
    const entries = this.data.customs[ownerId]!;
    return Object.hasOwn(entries, id) ? entries[id]! : null;
  }

  async listCustoms(ownerId: string): Promise<CharacterSheet[]> {
    return Object.values(this.data.customs[ownerId] ?? {}).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  async putCustom(sheet: CharacterSheet): Promise<void> {
    if (!sheet.ownerId) return;
    (this.data.customs[sheet.ownerId] ??= {})[sheet.id] = sheet;
    this.save();
  }

  async deleteCustom(ownerId: string, id: string): Promise<void> {
    if (this.data.customs[ownerId]) delete this.data.customs[ownerId][id];
    this.save();
  }

  async addWin(ownerId: string, id: string): Promise<number | null> {
    const sheet = this.data.customs[ownerId]?.[id];
    if (!sheet) return null;
    const wins = (sheet.wins ?? 0) + 1;
    this.data.customs[ownerId]![id] = applyProgress(sheet, wins);
    this.save();
    return wins;
  }

  async putMatch(record: MatchRecord): Promise<void> {
    this.data.matches.push(record);
    if (this.data.matches.length > 200) this.data.matches.splice(0, this.data.matches.length - 200);
    this.save();
  }

  async listMatches(limit: number): Promise<MatchRecord[]> {
    return this.data.matches.slice(-limit).reverse();
  }
}
