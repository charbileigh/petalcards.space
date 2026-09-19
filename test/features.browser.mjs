import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startServer } from '../src/server.mjs';

const directory = mkdtempSync(join(tmpdir(), 'petalcards-features-'));
const instance = await startServer({ host: '127.0.0.1', port: 0, dbPath: join(directory, 'absent.sqlite') });
const url = `http://127.0.0.1:${instance.address.port}`;
const launch = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(process.env.PETALCARDS_BROWSER_PATH ? { executablePath: process.env.PETALCARDS_BROWSER_PATH } : {}) };
const browser = await chromium.launch(launch);
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const storage = (name, ...args) => page.evaluate(async ({ name, args }) => (await import('/storage.js'))[name](...args), { name, args });
const ready = () => page.waitForSelector('#app-shell:not(.hidden)');
const home = () => page.locator('#deck-view [data-action="dashboard"]').click();
const open = (id) => page.locator(`.deck-card[data-deck-id="${id}"]`).click();
const count = async (id) => (await storage('getDeck', id)).deck.cards.length;
const counter = (index) => page.waitForFunction((index) => document.querySelector('#study-counter').textContent.startsWith(`Card ${index} of`), index);
const flip = async () => { await page.click('#active-flashcard'); await page.waitForSelector('#active-flashcard[aria-pressed="true"]'); };
const cardRow = (front) => page.locator('.library-card').filter({ has: page.locator('.card-copy p', { hasText: front }) });
try {
  // Seed a genuine v1 store before loading the app to exercise the schema upgrade.
  await page.goto(`${url}/favicon.svg`);
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('petalcards-device', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('decks', { keyPath: 'id' }); r.result.createObjectStore('meta'); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['decks', 'meta'], 'readwrite');
      tx.objectStore('meta').put(true, 'initialized'); tx.objectStore('meta').put({ name: 'Learner' }, 'profile');
      tx.objectStore('decks').put({ id: 'v1-deck', title: 'Existing biology', description: 'My saved cards', accent: 'mint', createdAt: Date.now(), updatedAt: Date.now(), cards: [{ id: 'v1-card', deckId: 'v1-deck', front: 'Old question', back: 'Old answer', hint: '', intervalDays: 4, ease: 2.5, dueAt: Date.now() + 86400000, reviewCount: 3, correctCount: 3, lastRating: 'good' }] });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close();
  });
  await page.goto(url); await ready();
  await page.waitForFunction(() => document.querySelector('#offline-status').textContent === 'Ready for offline use');
  assert.equal((await storage('getDeck', 'v1-deck')).deck.cards[0].reviewCount, 3);
  assert.equal((await storage('dashboard')).stats.decks, 1);
  await context.setOffline(true); await page.reload(); await ready();
  assert.equal((await storage('dashboard')).backup.revision, 0, 'reload is not a library change');
  console.log('PASS: v1 data upgrades intact; all new flows below run offline.');

  // Import a real CSV file, including commas, multiline answers, tags and an HTML payload.
  const csv = 'Front,Back,Hint,Tags\r\n"**Photosynthesis**","Light, water and CO2","Think chloroplasts","biology, plants"\r\n"<img src=x onerror=alert(1)>","Literal HTML stays text",,"safety"\r\n"Cell wall","Support\nand protection",,cells';
  await page.setInputFiles('#import-file', { name: 'Botany.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForSelector('#bulk-dialog[open]');
  assert.match(await page.locator('#bulk-preview').innerText(), /3 cards ready/);
  assert.equal(await page.locator('#bulk-preview img').count(), 0);
  await page.click('#bulk-submit'); await page.waitForSelector('#deck-view:not(.hidden)');
  const botany = (await storage('backup')).decks.find((d) => d.title === 'Botany');
  assert.equal(botany.cards.length, 3);
  assert.deepEqual(botany.cards[0].tags, ['biology', 'plants']);
  await page.locator('#deck-hero .more-menu summary').click(); await page.click('[data-action="edit-deck"]');
  await page.fill('#deck-folder', 'Science'); await page.fill('#deck-tags', 'semester 1, plants'); await page.click('#deck-submit');
  await page.waitForSelector('#deck-dialog:not([open])', { state: 'attached' });
  await page.fill('#card-search', 'protection'); assert.equal(await page.locator('.library-card').count(), 1);
  await page.fill('#card-search', '');
  await cardRow('Photosynthesis').locator('[data-action="favorite-card"]').click();
  await page.waitForSelector('[data-action="favorite-card"][aria-pressed="true"]');
  await page.click('#card-favorite-filter'); assert.equal(await page.locator('.library-card').count(), 1);
  await page.click('#card-favorite-filter');

  // Image upload and save-and-add-another use the same editor as ordinary cards.
  await page.locator('#deck-view [data-action="new-card"]').first().click();
  await page.fill('#card-front', 'Illustrated **leaf**'); await page.fill('#card-back', 'A leaf captures light.');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#648575'; x.fillRect(0, 0, 300, 200); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('#front-image-file', { name: 'leaf.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForSelector('#front-image-preview:not(.hidden)');
  await page.fill('#front-image-alt', 'Green illustration of a leaf');
  await page.click('#card-add-another');
  await page.waitForFunction(() => document.querySelector('#card-front').value === '');
  assert.equal(await count(botany.id), 4);
  await page.fill('#card-front', 'Stomata'); await page.fill('#card-back', 'Pores for gas exchange'); await page.click('#card-submit');
  await page.waitForSelector('#card-dialog:not([open])', { state: 'attached' });
  assert.equal(await count(botany.id), 5);
  const leaf = (await storage('getDeck', botany.id)).deck.cards.find((c) => c.front.startsWith('Illustrated'));
  assert.equal(leaf.frontImage.alt, 'Green illustration of a leaf'); assert.match(leaf.frontImage.src, /^data:image\/webp/);
  await home();
  await page.fill('#deck-search', 'gas exchange'); assert.equal(await page.locator('.deck-card').count(), 1);
  await page.fill('#deck-search', ''); await page.selectOption('#folder-filter', 'Science');
  assert.equal(await page.locator('.deck-card').count(), 1); await page.selectOption('#folder-filter', '');
  await page.selectOption('#tag-filter', 'plants'); assert.equal(await page.locator('.deck-card').count(), 1); await page.selectOption('#tag-filter', '');
  await page.locator(`[data-action="favorite-deck"][data-deck-id="${botany.id}"]`).click();
  await page.waitForSelector(`[data-action="favorite-deck"][data-deck-id="${botany.id}"][aria-pressed="true"]`);
  await page.click('#favorite-filter'); assert.equal(await page.locator('.deck-card').count(), 1); await page.click('#favorite-filter');
  console.log('PASS: CSV import, safe previews, image editing, quick entry, folders, tags and card/deck search and favourites.');

  await open(botany.id);
  await cardRow('Stomata').locator('[data-action="delete-card"]').click(); await page.click('#confirm-button');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(async (id) => (await (await import('/storage.js')).getDeck(id)).deck.cards.length === 5, botany.id);
  await cardRow('Stomata').locator('[data-action="delete-card"]').click(); await page.click('#confirm-button');
  await home(); await page.locator('.decks-section .library-tools [data-action="trash"]').click();
  await page.locator('[data-action="restore-trash"]').click(); await page.waitForFunction(() => document.querySelector('#trash-list').textContent.includes('empty'));
  await page.click('[data-close="trash-dialog"]');
  assert.equal(await count(botany.id), 5);
  await open(botany.id);
  await cardRow('Cell wall').locator('[data-action="transfer-card"]').click(); await page.selectOption('#transfer-target', 'v1-deck'); await page.click('#transfer-form button[type=submit]');
  await page.waitForSelector('#transfer-dialog:not([open])', { state: 'attached' });
  assert.equal(await count(botany.id), 4); assert.equal(await count('v1-deck'), 2);
  await home(); await open('v1-deck');
  await cardRow('Old question').locator('[data-action="transfer-card"]').click(); await page.selectOption('#transfer-target', botany.id); await page.selectOption('#transfer-mode', 'copy'); await page.click('#transfer-form button[type=submit]');
  await page.waitForSelector('#transfer-dialog:not([open])', { state: 'attached' });
  assert.equal((await storage('getDeck', botany.id)).deck.cards.find((c) => c.front === 'Old question').reviewCount, 0);
  assert.equal((await storage('getDeck', 'v1-deck')).deck.cards[0].reviewCount, 3);
  // Removing a whole deck is reversible, including image data and existing progress.
  await page.locator('#deck-hero .more-menu summary').click(); await page.click('[data-action="delete-deck"]'); await page.click('#confirm-button');
  await page.waitForSelector('#dashboard-view:not(.hidden)');
  await page.locator('.decks-section .library-tools [data-action="trash"]').click(); await page.locator('[data-action="restore-trash"]').click();
  await page.waitForFunction(() => document.querySelector('#trash-list').textContent.includes('empty')); await page.click('[data-close="trash-dialog"]');
  assert.equal((await storage('getDeck', 'v1-deck')).deck.cards[0].reviewCount, 3);
  console.log('PASS: undo, recycle bin, deck recovery, card move and copy preserve the correct data.');

  await open(botany.id); await page.click('#deck-hero [data-action="study-deck"]');
  await page.selectOption('#study-mode', 'all'); await page.click('#study-start'); await counter(1);
  assert.equal(await page.locator('.flash-front strong').innerText(), 'Photosynthesis');
  await page.keyboard.press('ArrowRight'); await counter(2);
  assert.equal((await storage('getDeck', botany.id)).deck.cards[0].reviewCount, 0, 'navigation does not grade');
  await page.keyboard.press('ArrowLeft'); await counter(1);
  await flip(); await page.keyboard.press('1'); await page.keyboard.press('1'); await counter(2);
  assert.equal((await storage('getDeck', botany.id)).deck.cards[0].reviewCount, 1);
  await page.keyboard.press('ArrowLeft'); await counter(1); await flip();
  assert.equal(await page.locator('.rating-button:disabled').count(), 4);
  await page.selectOption('#study-jump', '2'); await counter(3);
  assert.equal(await page.locator('.flash-front img').getAttribute('alt'), 'Green illustration of a leaf');
  await flip();
  const saved = await storage('getSession'); assert.equal(saved.index, 2); assert.equal(saved.flipped, true);
  await page.reload(); await ready(); await page.locator('#resume-banner [data-action="resume-study"]').click(); await counter(3);
  assert.equal(await page.locator('#active-flashcard').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.rating-button:disabled').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile study has no horizontal overflow');
  // A swipe advances while suppressing the follow-up click that would flip the new card.
  await page.locator('#active-flashcard').dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 300, clientY: 250 });
  await page.locator('#active-flashcard').dispatchEvent('pointerup', { pointerType: 'touch', clientX: 100, clientY: 253 });
  await counter(4); await page.locator('#active-flashcard').dispatchEvent('click');
  assert.equal((await storage('getSession')).flipped, false);
  await page.click('[data-action="focus-study"]');
  await page.waitForFunction(() => document.body.classList.contains('study-focus'));
  await page.click('[data-action="exit-study"]'); await home();
  assert.match(await page.locator('#today-summary').innerText(), /1 card reviewed today/);
  assert.equal((await storage('dashboard')).progress.difficult[0].id, botany.cards[0].id);
  await page.click('#settings-button'); await page.selectOption('#card-text-size', 'larger'); await page.click('#accessibility-form button[type=submit]');
  await page.waitForFunction(() => document.documentElement.dataset.cardSize === 'larger'); await page.click('[data-close="settings-dialog"]');
  console.log('PASS: keyboard, swipe, jump, skipping without grading, duplicate-rating protection, offline resume including flipped side, progress and reading settings.');

  const favoriteSession = await storage('beginSession', botany.id, { mode: 'favorites', reverse: true });
  assert.deepEqual(favoriteSession.cardIds, [botany.cards[0].id]); assert.equal(favoriteSession.reverse, true);
  const difficult = await storage('beginSession', botany.id, { mode: 'difficult' }); assert.deepEqual(difficult.cardIds, [botany.cards[0].id]);
  const due = await storage('beginSession', botany.id, { mode: 'due' }); assert.equal(due.cardIds.includes(botany.cards[0].id), false);
  const limited = await storage('beginSession', botany.id, { mode: 'all', shuffle: true, limit: 2, reverse: true }); assert.equal(limited.cardIds.length, 2); assert.equal(new Set(limited.cardIds).size, 2);
  await page.reload(); await ready(); await page.locator('#resume-banner [data-action="resume-study"]').click(); await counter(1);
  assert.equal(await page.locator('.flash-front .face-label').innerText(), 'ANSWER');
  await page.click('[data-action="exit-study"]'); await home();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const pending = page.waitForEvent('download'); await page.locator('.decks-section .library-tools [data-action="backup"]').click();
  const backup = JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  assert.equal(backup.version, 2); assert.equal(backup.decks.find((d) => d.id === botany.id).cards.find((c) => c.id === leaf.id).frontImage.alt, leaf.frontImage.alt);
  await page.waitForFunction(async () => { const d = await (await import('/storage.js')).dashboard(); return d.backup.backupRevision === d.backup.revision; });
  const revision = (await storage('dashboard')).backup.revision;
  await page.reload(); await ready(); assert.equal((await storage('dashboard')).backup.revision, revision);
  await storage('importLibrary', backup);
  const restored = (await storage('backup')).decks.filter((d) => d.title === 'Botany'); assert.equal(restored.length, 2);
  assert.equal(restored.find((d) => d.id !== botany.id).cards.find((c) => c.front.startsWith('Illustrated')).frontImage.src, leaf.frontImage.src);
  const before = (await storage('dashboard')).stats.decks;
  await assert.rejects(storage('importLibrary', { decks: [{ title: 'Unsafe', cards: [{ front: 'X', back: 'Y', frontImage: { src: 'data:image/svg+xml;base64,AAA=' } }] }] }), /PNG, JPEG or WebP/);
  assert.equal((await storage('dashboard')).stats.decks, before);
  // Stored backup revision must not swallow changes made after a snapshot was taken.
  const snapshot = await storage('backup'); await storage('toggleFavorite', botany.id); await storage('markBackup', snapshot.revision);
  assert.ok((await storage('dashboard')).backup.revision > (await storage('dashboard')).backup.backupRevision);
  assert.deepEqual(errors, []);
  console.log('PASS: study filters, shuffle/limits, reverse faces, image backup/restore, invalid-image rejection and backup revisions.');

  const portable = await browser.newPage(); const portableErrors = []; portable.on('pageerror', (e) => portableErrors.push(e.message));
  await portable.goto(new URL('../docs/Petalcards_Preview.html', import.meta.url).href);
  await portable.waitForSelector('#app-shell:not(.hidden)');
  await portable.getByRole('button', { name: 'New deck', exact: true }).click(); await portable.fill('#deck-title', 'Portable preview test'); await portable.click('#deck-submit');
  await portable.waitForSelector('#deck-view:not(.hidden)'); await portable.reload(); await portable.waitForSelector('#app-shell:not(.hidden)');
  assert.match(await portable.locator('#deck-grid').innerText(), /Portable preview test/); assert.deepEqual(portableErrors, []);
  console.log('PASS: standalone HTML preview opens and persists edits after reload.');
  console.log('All feature checks passed.');
} catch (error) { await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }); console.error(`Failure screenshot: ${directory}/failure.png`); throw error; }
finally { await browser.close(); await new Promise((resolve) => instance.server.close(resolve)); instance.db.close(); if (!process.env.PETALCARDS_KEEP_TEST) rmSync(directory, { recursive: true, force: true }); }
