import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCustom } from '../src/shared/designer';
import { ROSTER } from '../src/shared/roster';
import { FileStore } from '../src/server/store/file';

describe('file persistence', () => {
  it('fixes legends on first write, saves progression, and never returns object prototype members', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mythic-store-'));
    const store = new FileStore(dir);
    try {
      await store.putLegend('arjuna', ROSTER[0]);
      await store.putLegend('arjuna', { ...ROSTER[0], rating: 1 });
      expect((await store.getLegend('arjuna'))?.rating).toBe(ROSTER[0].rating);
      const sheet = buildCustom({ name: 'Keeper', weapon: 'bow' }, 'owner123', 'custom123', 0);
      await store.putCustom(sheet);
      await Promise.all([store.addWin('owner123', sheet.id), store.addWin('owner123', sheet.id), store.addWin('owner123', sheet.id)]);
      expect((await store.getCustom('owner123', sheet.id))?.level).toBe(2);
      expect(await store.getLegend('constructor')).toBeNull();
      expect(await store.getCustom('owner123', '__proto__')).toBeNull();
      expect(await store.getCustom('constructor', 'prototype')).toBeNull();
      store.flush();
      const reopened = new FileStore(dir);
      expect((await reopened.getCustom('owner123', sheet.id))?.wins).toBe(3);
    } finally { store.flush(); rmSync(dir, { recursive: true, force: true }); }
  });
});
