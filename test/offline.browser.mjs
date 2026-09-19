import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startServer } from '../src/server.mjs';

const directory = mkdtempSync(join(tmpdir(), 'petalcards-browser-'));
const instance = await startServer({ host: '127.0.0.1', port: 0, dbPath: join(directory, 'absent.sqlite') });
const url = `http://127.0.0.1:${instance.address.port}`;
const launch = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(process.env.PETALCARDS_BROWSER_PATH ? { executablePath: process.env.PETALCARDS_BROWSER_PATH } : {}) };
let context, secondBrowser;
const errors = [];
const loadLibrary = (page, fn, argument) => page.evaluate(async ({ fn, argument }) => {
  const library = await import('/storage.js');
  return library[fn](...(argument || []));
}, { fn, argument });

try {
  context = await chromium.launchPersistentContext(join(directory, 'profile'), { ...launch, viewport: { width: 1440, height: 1000 } });
  let page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForSelector('#app-shell:not(.hidden)');
  await page.waitForFunction(() => document.querySelector('#offline-status').textContent === 'Ready for offline use');
  assert.equal(await page.locator('input[type=email], input[type=password], #login-form, #register-form').count(), 0);
  assert.equal((await context.cookies()).length, 0);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  assert.equal(manifest.errors.length, 0);
  assert.equal(JSON.parse(manifest.data).display, 'standalone');
  const installability = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors, []);
  await page.click('#install-button');
  if (await page.locator('#install-dialog[open]').count()) await page.click('[data-close="install-dialog"]');
  if (process.env.PETALCARDS_PREVIEW_PATH) {
    mkdirSync(dirname(process.env.PETALCARDS_PREVIEW_PATH), { recursive: true });
    await page.screenshot({ path: process.env.PETALCARDS_PREVIEW_PATH, fullPage: true });
  }
  console.log('PASS: opens with no account or cookie; valid installable manifest and complete offline shell.');

  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#app-shell:not(.hidden)');
  await page.getByRole('button', { name: 'New deck', exact: true }).click();
  await page.fill('#deck-title', 'Offline biology');
  await page.fill('#deck-description', 'Saved without a connection');
  await page.click('#deck-submit');
  await page.waitForSelector('#deck-view:not(.hidden)');
  await page.locator('#deck-view [data-action="new-card"]').first().click();
  await page.fill('#card-front', 'What carries water?');
  await page.fill('#card-back', 'Xylem');
  await page.fill('#card-hint', 'Think stems');
  await page.click('#card-submit');
  await page.waitForSelector('.library-card');
  await page.click('[data-action="edit-card"]');
  await page.fill('#card-back', 'Xylem tissue');
  await page.click('#card-submit');
  await page.waitForFunction(() => document.querySelector('#card-list').textContent.includes('Xylem tissue'));
  await page.click('#deck-hero [data-action="study-deck"]');
  await page.click('#active-flashcard');
  await page.keyboard.press('3');
  await page.keyboard.press('3');
  await page.waitForSelector('.study-complete');
  let saved = await loadLibrary(page, 'backup');
  let deck = saved.decks.find((item) => item.title === 'Offline biology');
  assert.equal(deck.cards[0].reviewCount, 1, 'double keypress must not duplicate a review');
  assert.equal(deck.cards[0].back, 'Xylem tissue');
  await page.click('#theme-menu summary');
  await page.click('[data-theme-choice="purple"]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'purple');
  await page.reload();
  await page.waitForSelector('#app-shell:not(.hidden)');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'purple');
  assert.equal((await loadLibrary(page, 'getDeck', [deck.id])).deck.cards[0].reviewCount, 1);
  console.log('PASS: offline reload, deck/card creation and editing, review progress and theme persistence.');

  // Exercise a committed-write failure through the real editor.
  await page.locator(`.deck-card[data-deck-id="${deck.id}"]`).click();
  await page.click('[data-action="edit-card"]');
  await page.fill('#card-back', 'Must not be committed');
  await page.evaluate(() => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('No space', 'QuotaExceededError'); };
  });
  await page.click('#card-submit');
  await page.waitForSelector('.toast.error');
  assert.equal(await page.locator('#card-dialog').getAttribute('open'), '');
  assert.equal((await loadLibrary(page, 'getDeck', [deck.id])).deck.cards[0].back, 'Xylem tissue');
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
  await page.click('[data-close="card-dialog"]');
  console.log('PASS: failed writes keep the editor open and preserve committed data.');

  await page.click('#deck-hero .more-menu summary');
  const csvPending = page.waitForEvent('download');
  await page.click('[data-action="export-deck"][data-format="csv"]');
  const csv = await csvPending;
  assert.match(readFileSync(await csv.path(), 'utf8'), /Xylem tissue/);
  const jsonPending = page.waitForEvent('download');
  await page.click('[data-action="export-deck"][data-format="json"]');
  const json = await jsonPending;
  const exported = JSON.parse(readFileSync(await json.path(), 'utf8'));
  assert.equal(exported.deck.cards[0].reviewCount, 1);
  await page.click('[data-action="dashboard"]');
  const backupPending = page.waitForEvent('download');
  await page.locator('#dashboard-view [data-action="backup"]').click();
  const backupDownload = await backupPending;
  const backupContent = readFileSync(await backupDownload.path());
  const backupPath = join(directory, 'backup.json');
  await backupDownload.saveAs(backupPath);
  await page.setInputFiles('#import-file', { name: 'old-deck.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ deck: { title: 'Old export', cards: [{ front: 'Old front', back: 'Old back' }] } })) });
  await page.waitForFunction(() => document.querySelector('#deck-grid').textContent.includes('Old export'));
  const countBefore = (await loadLibrary(page, 'dashboard')).stats.decks;
  await page.setInputFiles('#import-file', { name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ decks: [{ title: 'Valid', cards: [] }, { title: '', cards: [] }] })) });
  await page.waitForFunction(() => [...document.querySelectorAll('.toast.error')].some((item) => item.textContent.includes('Deck title is required')));
  assert.equal((await loadLibrary(page, 'dashboard')).stats.decks, countBefore, 'invalid import must be atomic');
  console.log('PASS: offline CSV/JSON downloads, full backup, old-export import and atomic invalid-import rejection.');

  // Two tabs write the same deck without overwriting each other's new cards.
  const tab = await context.newPage();
  await tab.goto(url);
  await tab.waitForSelector('#app-shell:not(.hidden)');
  await Promise.all([
    loadLibrary(page, 'createCard', [deck.id, { front: 'First tab', back: 'One' }]),
    loadLibrary(tab, 'createCard', [deck.id, { front: 'Second tab', back: 'Two' }]),
  ]);
  assert.equal((await loadLibrary(page, 'getDeck', [deck.id])).deck.cards.length, 3);
  await tab.close();
  await context.close(); context = null;
  context = await chromium.launchPersistentContext(join(directory, 'profile'), { ...launch, offline: true });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForSelector('#app-shell:not(.hidden)');
  assert.equal((await loadLibrary(page, 'getDeck', [deck.id])).deck.cards.length, 3);
  console.log('PASS: concurrent tab edits and a full browser restart while offline preserve saved cards.');

  await context.setOffline(false);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone layout must not overflow');
  await page.click('#settings-button');
  assert.equal(await page.locator('#settings-dialog input').count(), 1);
  await page.fill('#profile-name', 'Chabi');
  await page.locator('#profile-form button').click();
  await page.waitForFunction(() => document.querySelector('#user-name-short').textContent === 'Chabi');
  await page.click('[data-close="settings-dialog"]');
  await page.locator('.toast').evaluateAll((items) => items.forEach((item) => item.remove()));
  if (process.env.PETALCARDS_PREVIEW_PATH) await page.screenshot({ path: process.env.PETALCARDS_PREVIEW_PATH.replace(/\.png$/, '-mobile.png'), fullPage: true });

  secondBrowser = await chromium.launch(launch);
  const separate = await secondBrowser.newContext();
  const separatePage = await separate.newPage();
  await separatePage.goto(url);
  await separatePage.waitForSelector('#app-shell:not(.hidden)');
  assert.equal((await loadLibrary(separatePage, 'dashboard')).stats.decks, 1);
  await separatePage.setInputFiles('#import-file', { name: 'backup.json', mimeType: 'application/json', buffer: backupContent });
  await separatePage.waitForFunction(() => document.querySelector('#deck-grid').textContent.includes('Offline biology'));
  const imported = (await loadLibrary(separatePage, 'backup')).decks.find((item) => item.title === 'Offline biology');
  assert.equal(imported.cards[0].reviewCount, 1);
  assert.notEqual(imported.id, deck.id);

  const legacy = { sourceId: 'previous-browser-session', decks: [{ title: 'Previous collection', cards: [{ front: 'Previous question', back: 'Previous answer', reviewCount: 4 }] }] };
  assert.equal(await loadLibrary(separatePage, 'importLibrary', [legacy, { sourceId: legacy.sourceId }]), 1);
  assert.equal(await loadLibrary(separatePage, 'importLibrary', [legacy, { sourceId: legacy.sourceId }]), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: mobile layout, optional name, separate browsers, backup transfer and idempotent legacy recovery.');
  console.log('All browser checks passed.');
} finally {
  await context?.close();
  await secondBrowser?.close();
  await new Promise((resolve) => instance.server.close(resolve));
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
}
