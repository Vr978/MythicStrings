// Persistence behind one interface: a JSON file for development, DynamoDB in production.
import type { CharacterSheet } from '../../shared/types';
import { config } from '../config';
import { DynamoStore } from './dynamo';
import { FileStore } from './file';

export interface MatchRecord {
  id: string;
  at: number;
  mode: 'online' | 'local';
  fighters: [string, string];
  players: [string, string];
  winner: 0 | 1 | 2;
  reason: string;
  hp: [number, number];
}

export interface Store {
  readonly kind: 'file' | 'dynamodb';
  /** A summoned legend's sheet. Written once per name and never changed, so its ratings stay fixed. */
  getLegend(slug: string): Promise<CharacterSheet | null>;
  putLegend(slug: string, sheet: CharacterSheet): Promise<void>;
  listLegends(limit: number): Promise<CharacterSheet[]>;
  getCustom(ownerId: string, id: string): Promise<CharacterSheet | null>;
  listCustoms(ownerId: string): Promise<CharacterSheet[]>;
  putCustom(sheet: CharacterSheet): Promise<void>;
  deleteCustom(ownerId: string, id: string): Promise<void>;
  /** Adds one win atomically and returns the new total, or null when the character does not exist. */
  addWin(ownerId: string, id: string): Promise<number | null>;
  putMatch(record: MatchRecord): Promise<void>;
  listMatches(limit: number): Promise<MatchRecord[]>;
}

export function createStore(): Store {
  if (config.store.table) {
    console.log(`[store] DynamoDB table ${config.store.table} in ${config.store.region}`);
    return new DynamoStore(config.store.table, config.store.region);
  }
  console.log(`[store] JSON file in ${config.dataDir}`);
  return new FileStore(config.dataDir);
}
