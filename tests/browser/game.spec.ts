import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter the theatre' })).toBeVisible();
}

test('local duel: controls, two simultaneous mantras, damage, and results', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('Browser error: ' + e.message); });
  await ready(page);
  await page.screenshot({ path: 'artifacts/home-desktop.png' });
  await page.getByRole('button', { name: 'Local duel' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your legend.' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/selection-desktop.png' });
  await page.locator('[data-start]').click();
  await expect(page.locator('.intro-count')).toBeHidden();
  const before = Number(await page.locator('.fighter-1 .health').getAttribute('aria-valuenow'));
  await page.keyboard.down('KeyK');
  await expect.poll(async () => Number(await page.locator('.fighter-1 .health').getAttribute('aria-valuenow'))).toBeLessThan(before);
  await page.keyboard.up('KeyK');
  await page.keyboard.press('KeyQ');
  await expect(page.getByRole('textbox', { name: 'Player 1 mantra' })).toBeVisible();
  await page.locator('[data-controls="1"] [data-key="prompt"]').click();
  await expect(page.getByRole('textbox', { name: 'Player 2 mantra' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Player 1 mantra' }).fill('rain of fifty burning arrows from the sky');
  await page.getByRole('textbox', { name: 'Player 2 mantra' }).fill('dome of lightning');
  await page.screenshot({ path: 'artifacts/simultaneous-mantras.png' });
  await page.locator('[data-prompt="1"] button[type="submit"]').click();
  await page.locator('[data-prompt="0"] button[type="submit"]').click();
  await expect(page.locator('.verdict')).toBeVisible();
  await expect(page.locator('[data-prompt="0"]')).toBeHidden();
  await expect(page.locator('[data-prompt="1"]')).toBeHidden();
  await page.screenshot({ path: 'artifacts/duel-desktop.png' });
  await page.keyboard.down('KeyK');
  await expect(page.locator('#result')).toBeVisible({ timeout: 55_000 });
  await page.keyboard.up('KeyK');
  await expect(page.locator('.result-card h1')).toContainText(/prevails|equal legend/);
  await page.getByRole('button', { name: 'Play again' }).click();
  await expect(page.locator('#result')).toBeHidden();
  expect(errors).toEqual([]);
});

test('forge: weapon moves, generated garment, save, edit, and reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('Browser error: ' + e.message); });
  await ready(page);
  await page.getByRole('button', { name: /Forge your own/ }).click();
  await page.getByRole('textbox', { name: 'Character name' }).fill('Sunweaver');
  await page.getByLabel('Weapon', { exact: true }).selectOption('bow');
  await page.getByLabel('Facial hair', { exact: true }).selectOption('mustache');
  await page.getByRole('textbox', { name: 'Describe your custom piece' }).fill('An emerald silk shirt with golden sun borders');
  await page.locator('[data-craft]').click();
  await expect(page.locator('.custom-pieces')).toContainText('emerald');
  await page.screenshot({ path: 'artifacts/forge-desktop.png' });
  await page.getByRole('button', { name: 'Bring to life' }).click();
  await expect(page.locator('[data-character]').filter({ hasText: 'Sunweaver' })).toBeVisible();
  await expect(page.locator('[data-side="0"]')).toContainText('60');
  await page.reload();
  await page.getByRole('button', { name: 'Local duel' }).click();
  await page.getByRole('button', { name: /Your creations/ }).click();
  await page.locator('[data-character]').filter({ hasText: 'Sunweaver' }).click();
  await expect(page.locator('[data-side="0"]')).toContainText('Sunweaver');
  await page.locator('[data-edit="0"]').click();
  await expect(page.getByRole('textbox', { name: 'Character name' })).toHaveValue('Sunweaver');
  await expect(page.getByLabel('Weapon', { exact: true })).toHaveValue('bow');
  expect(errors).toEqual([]);
});

test('two independent browsers join by invite, share authoritative HP, and handle a forfeit', async ({ browser }) => {
  const first = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const second = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const a = await first.newPage(), b = await second.newPage();
  try {
    await ready(a);
    await a.getByRole('button', { name: 'Play online' }).click();
    await a.locator('[data-host]').click();
    await expect(a.locator('.invite-code')).toBeVisible();
    const code = (await a.locator('.invite-code').innerText()).trim();
    await a.screenshot({ path: 'artifacts/online-lobby.png' });
    await b.goto('/?join=' + code);
    await expect(b.locator('[data-join]')).toBeVisible();
    await b.locator('[data-join] button').click();
    await expect(a.locator('.fighter-hud')).toHaveCount(2);
    await expect(b.locator('.fighter-hud')).toHaveCount(2);
    await expect(a.locator('.intro-count')).toBeHidden();
    const before = Number(await b.locator('.fighter-1 .health').getAttribute('aria-valuenow'));
    await a.keyboard.down('KeyK');
    await expect.poll(async () => Number(await b.locator('.fighter-1 .health').getAttribute('aria-valuenow'))).toBeLessThan(before);
    await a.keyboard.up('KeyK');
    await expect.poll(async () => a.locator('.fighter-1 .health').getAttribute('aria-valuenow')).toBe(await b.locator('.fighter-1 .health').getAttribute('aria-valuenow'));
    await Promise.all([a.keyboard.press('KeyQ'), b.keyboard.press('KeyQ')]);
    await expect(a.getByRole('textbox', { name: 'Player 1 mantra' })).toBeVisible();
    await expect(b.getByRole('textbox', { name: 'Player 2 mantra' })).toBeVisible();
    await a.getByRole('textbox', { name: 'Player 1 mantra' }).fill('lightning spear');
    await b.getByRole('textbox', { name: 'Player 2 mantra' }).fill('dome of light');
    await Promise.all([a.getByRole('textbox', { name: 'Player 1 mantra' }).press('Enter'), b.getByRole('textbox', { name: 'Player 2 mantra' }).press('Enter')]);
    await expect(a.locator('[data-prompt="0"]')).toBeHidden();
    await expect(b.locator('[data-prompt="1"]')).toBeHidden();
    await b.locator('#leave-duel').click();
    await expect(a.locator('#result')).toBeVisible();
    await expect(a.locator('[data-rematch]')).toBeDisabled();
    await expect(a.locator('.rematch-note')).toContainText('new invite');
  } finally { await first.close(); await second.close(); }
});

test('the mobile theatre fits without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.screenshot({ path: 'artifacts/home-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Local duel' }).click();
  await expect(page.locator('[data-start]')).toBeVisible();
  await page.locator('[data-start]').click();
  await expect(page.locator('.touch-movement')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/duel-mobile.png', fullPage: true });
});
