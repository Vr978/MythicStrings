import { test, expect } from '@playwright/test';

test('guest collections require their owner token and edits cannot change wins or weapon rules', async ({ request }) => {
  const session = await (await request.post('/api/session', { data: {} })).json();
  const other = await (await request.post('/api/session', { data: {} })).json();
  const headers = { Authorization: 'Bearer ' + session.token };
  const forged = await request.post('/api/characters', { headers, data: {
    owner: session.id, input: { name: 'Test Archer', weapon: 'bow', specialId: 'mace.quake', wins: 999, rating: 100, look: {
      custom: { top: { id: 'testsvg', name: 'Top', svg: '<svg><script>alert(1)</script><rect width="70" height="80" fill="#ddaa33" onclick="alert(1)"/><image href="https://example.com/a.png"/></svg>' } },
    } },
  } });
  expect(forged.ok()).toBe(true);
  const { sheet } = await forged.json();
  expect(sheet.rating).toBe(60);
  expect(sheet.moves.special.id).toContain('bow.');
  expect(sheet.look.custom.top.svg).not.toMatch(/script|onclick|href|<image/);
  const attack = await request.get('/api/characters?owner=' + session.id, { headers: { Authorization: 'Bearer ' + other.token } });
  expect(attack.status()).toBe(401);
  const unownedDelete = await request.delete('/api/characters?owner=' + session.id + '&id=' + sheet.id);
  expect(unownedDelete.status()).toBe(401);
  const recovered = await (await request.post('/api/session', { data: { id: session.id, token: session.token } })).json();
  expect(recovered.id).toBe(session.id);
  const impersonation = await (await request.post('/api/session', { data: { id: session.id } })).json();
  expect(impersonation.id).not.toBe(session.id);
});

test('practice does not grant progression; three human wins reach rank two', async ({ request }) => {
  const session = await (await request.post('/api/session', { data: {} })).json();
  const headers = { Authorization: 'Bearer ' + session.token };
  const { sheet } = await (await request.post('/api/characters', { headers, data: { owner: session.id, input: { name: 'Rank Tester', weapon: 'fists' } } })).json();
  const body = { owner: session.id, picks: [{ id: sheet.id, name: sheet.name, custom: true }, { id: 'thor', name: 'Thor', custom: false }], winner: 0, hp: [30, 0], reason: 'ko', versus: 'cpu' };
  const practice = await (await request.post('/api/match', { headers, data: body })).json();
  expect(practice.progress).toEqual([]);
  for (let i = 0; i < 3; i++) {
    const response = await request.post('/api/match', { headers, data: { ...body, versus: 'local' } });
    expect(response.ok()).toBe(true);
  }
  const { characters } = await (await request.get('/api/characters?owner=' + session.id, { headers })).json();
  expect(characters[0].wins).toBe(3);
  expect(characters[0].level).toBe(2);
  expect(characters[0].rating).toBe(64);
});
