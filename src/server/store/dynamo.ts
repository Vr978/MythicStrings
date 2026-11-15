// DynamoDB store: one on-demand table with a string partition key `pk` and sort key `sk`.
//   LEGEND          / <slug>          a summoned legend, written once
//   OWNER#<owner>   / CHAR#<id>       a forged character, with an atomic `wins` counter
//   MATCH           / <time>#<id>     a finished duel
// Credentials come from the SDK chain (the EC2 instance role in production).
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { applyProgress } from '../../shared/designer';
import type { CharacterSheet } from '../../shared/types';
import type { MatchRecord, Store } from './index';

export class DynamoStore implements Store {
  readonly kind = 'dynamodb' as const;
  private readonly db: DynamoDBDocumentClient;

  constructor(private readonly table: string, region: string) {
    this.db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
  }

  private static sheet(item: Record<string, unknown> | undefined): CharacterSheet | null {
    if (!item || typeof item.doc !== 'string') return null;
    try {
      const sheet = JSON.parse(item.doc) as CharacterSheet;
      // The counter on the item is the truth; the copy inside the document may be older.
      return sheet.kind === 'custom' ? applyProgress(sheet, typeof item.wins === 'number' ? item.wins : sheet.wins ?? 0) : sheet;
    } catch {
      return null;
    }
  }

  async getLegend(slug: string): Promise<CharacterSheet | null> {
    const out = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: 'LEGEND', sk: slug }, ConsistentRead: true }));
    return DynamoStore.sheet(out.Item);
  }

  async putLegend(slug: string, sheet: CharacterSheet): Promise<void> {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: 'LEGEND', sk: slug, doc: JSON.stringify(sheet), at: sheet.createdAt ?? Date.now(), name: sheet.name },
          // First writer wins, so a legend's ratings can never be rewritten.
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
    }
  }

  async listLegends(limit: number): Promise<CharacterSheet[]> {
    const out = await this.db.send(
      new QueryCommand({ TableName: this.table, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': 'LEGEND' }, Limit: limit * 2 }),
    );
    const unique = new Map<string, CharacterSheet>();
    for (const item of out.Items ?? []) {
      const s = DynamoStore.sheet(item);
      if (s) unique.set(s.id, s);
    }
    return [...unique.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, limit);
  }

  async getCustom(ownerId: string, id: string): Promise<CharacterSheet | null> {
    const out = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: `OWNER#${ownerId}`, sk: `CHAR#${id}` }, ConsistentRead: true }));
    return DynamoStore.sheet(out.Item);
  }

  async listCustoms(ownerId: string): Promise<CharacterSheet[]> {
    const out = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: { ':pk': `OWNER#${ownerId}`, ':sk': 'CHAR#' },
      }),
    );
    return (out.Items ?? [])
      .map((i) => DynamoStore.sheet(i))
      .filter((s): s is CharacterSheet => s !== null)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  async putCustom(sheet: CharacterSheet): Promise<void> {
    if (!sheet.ownerId) return;
    await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: `OWNER#${sheet.ownerId}`, sk: `CHAR#${sheet.id}` },
        // `wins` is only initialised here, never overwritten, so an edit cannot reset or inflate it.
        UpdateExpression: 'SET doc = :doc, #n = :name, #at = :at, wins = if_not_exists(wins, :zero)',
        ExpressionAttributeNames: { '#n': 'name', '#at': 'at' },
        ExpressionAttributeValues: { ':doc': JSON.stringify(sheet), ':name': sheet.name, ':at': sheet.createdAt ?? Date.now(), ':zero': 0 },
      }),
    );
  }

  async deleteCustom(ownerId: string, id: string): Promise<void> {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: `OWNER#${ownerId}`, sk: `CHAR#${id}` } }));
  }

  async addWin(ownerId: string, id: string): Promise<number | null> {
    try {
      const out = await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: `OWNER#${ownerId}`, sk: `CHAR#${id}` },
          UpdateExpression: 'ADD wins :one',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: { ':one': 1 },
          ReturnValues: 'UPDATED_NEW',
        }),
      );
      const wins = out.Attributes?.wins;
      return typeof wins === 'number' ? wins : null;
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return null;
      throw err;
    }
  }

  async putMatch(record: MatchRecord): Promise<void> {
    await this.db.send(
      new PutCommand({ TableName: this.table, Item: { pk: 'MATCH', sk: `${String(record.at).padStart(15, '0')}#${record.id}`, doc: JSON.stringify(record) } }),
    );
  }

  async listMatches(limit: number): Promise<MatchRecord[]> {
    const out = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'MATCH' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    const records: MatchRecord[] = [];
    for (const item of out.Items ?? []) {
      try {
        records.push(JSON.parse(String(item.doc)) as MatchRecord);
      } catch {
        // Skip a record that cannot be read rather than failing the whole list.
      }
    }
    return records;
  }
}
