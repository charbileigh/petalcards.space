// Screenshots use an isolated browser and illustrative data; the shipped app stays unchanged.
import { chromium } from 'playwright';
import { startServer } from '../src/server.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const instance = await startServer({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(process.env.PETALCARDS_BROWSER_PATH ? { executablePath: process.env.PETALCARDS_BROWSER_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${instance.address.port}`);
  await page.waitForSelector('#app-shell:not(.hidden)');
  await page.waitForFunction(() => document.querySelector('#offline-status').textContent === 'Ready for offline use');
  const botany = await page.evaluate(async () => {
    const l = await import('/storage.js');
    for (const d of (await l.dashboard()).decks) await l.deleteDeck(d.id);
    await l.emptyTrash();
    const { deck } = await l.createDeck({ title: 'Botany basics', description: 'Small discoveries from the world of plants.', folder: 'Science', tags: ['plants', 'chapter 1'], favorite: true, accent: 'mint', cards: [
      { front: 'What powers **photosynthesis**?', back: '**Light energy** from the sun.\nPlants use it to turn water and carbon dioxide into sugars.', hint: 'Think about what a plant reaches towards.', tags: ['plants'], favorite: true },
      { front: 'What carries water from roots to leaves?', back: '**Xylem** — the plant’s water transport tissue.', tags: ['transport'] },
      { front: 'What do stomata do?', back: 'They allow gas exchange and regulate water loss.' },
      { front: 'Where does photosynthesis happen?', back: 'In the **chloroplasts**.' },
      { front: 'What supports a plant cell?', back: 'The cell wall, made mainly of cellulose.' },
    ] });
    await l.createDeck({ title: 'Everyday French', description: 'A few useful words, one conversation at a time.', folder: 'Languages', tags: ['vocabulary'], accent: 'lilac', cards: [{ front: 'Bonjour', back: 'Hello / Good morning' }, { front: 'Merci', back: 'Thank you' }, { front: 'À bientôt', back: 'See you soon' }] });
    await l.createDeck({ title: 'Learning that lasts', description: 'Make room for recall, rest and a little repetition.', folder: 'Study skills', tags: ['memory'], accent: 'peach', cards: [{ front: 'What is active recall?', back: 'Retrieving an answer from memory before checking it.' }, { front: 'Why space out practice?', back: 'Returning to ideas over time helps you remember them.' }] });
    await l.reviewCard(deck.id, deck.cards[1].id, 'hard');
    const backup = await l.backup(); await l.markBackup(backup.revision);
    await l.beginSession(deck.id, { mode: 'all' });
    return deck.id;
  });
  await page.reload(); await page.waitForSelector('#app-shell:not(.hidden)');
  await page.screenshot({ path: root + 'docs/preview.png', fullPage: true });
  await page.locator('#resume-banner [data-action="resume-study"]').click();
  await page.click('#active-flashcard'); await page.waitForSelector('#active-flashcard[aria-pressed="true"]');
  await page.getByRole('button', { name: 'Focus view', exact: true }).click();
  await page.waitForFunction(() => document.body.classList.contains('study-focus'));
  await page.screenshot({ path: root + 'docs/preview-study.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: root + 'docs/preview-mobile.png', fullPage: true, animations: 'disabled' });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile overflow');
  console.log('Captured collection, study and phone previews.');
} finally { await browser.close(); await new Promise((resolve) => instance.server.close(resolve)); instance.db.close(); }
