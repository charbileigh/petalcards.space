import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { startServer } from '../src/server.mjs';

let instance;
let baseUrl;
let cookie;
let temporaryDirectory;

async function call(path, { method = 'GET', body, session = cookie, origin } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session) headers.Cookie = session;
  if (origin) headers.Origin = origin;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, payload };
}

before(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'petalcards-test-'));
  instance = await startServer({ host: '127.0.0.1', port: 0, dbPath: join(temporaryDirectory, 'test.sqlite') });
  baseUrl = `http://127.0.0.1:${instance.address.port}`;
});

after(async () => {
  await new Promise((resolve) => instance.server.close(resolve));
  instance.db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('health check and private bootstrap', async () => {
  const health = await call('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.ok, true);
  const privateRequest = await call('/api/bootstrap', { session: null });
  assert.equal(privateRequest.response.status, 401);
});

test('serves the browser application and its assets', async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await page.text(), /id="study-view"/);
  const script = await fetch(`${baseUrl}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /text\/javascript/);
  assert.match(await script.text(), /function flipCard/);
});

test('registers a native account and opens the starter deck', async () => {
  const result = await call('/api/auth/register', {
    method: 'POST',
    body: { name: 'Aster Vale', email: 'aster@example.com', password: 'correct horse petal' },
    session: null,
  });
  assert.equal(result.response.status, 201);
  cookie = result.response.headers.get('set-cookie').split(';')[0];
  assert.equal(result.payload.user.email, 'aster@example.com');
  assert.equal(result.payload.theme, 'pink');
  assert.equal(result.payload.decks.length, 1);
  assert.equal(result.payload.decks[0].cardCount, 3);

  const deck = await call(`/api/decks/${result.payload.decks[0].id}`);
  assert.equal(deck.response.status, 200);
  assert.equal(deck.payload.deck.cards.length, 3);
});

test('creates a deck and card, then reviews that card', async () => {
  const createdDeck = await call('/api/decks', {
    method: 'POST',
    body: { title: 'Botany', description: 'Leaves and roots', accent: 'mint' },
  });
  assert.equal(createdDeck.response.status, 201);
  const deckId = createdDeck.payload.deck.id;

  const createdCard = await call(`/api/decks/${deckId}/cards`, {
    method: 'POST',
    body: { front: 'What is xylem?', back: 'Tissue that moves water upward.', hint: 'Think stems.' },
  });
  assert.equal(createdCard.response.status, 201);
  const cardId = createdCard.payload.card.id;

  const beforeReview = await call(`/api/decks/${deckId}`);
  assert.equal(beforeReview.payload.deck.cards[0].reviewCount, 0);
  assert.equal(beforeReview.payload.deck.dueCount, 1);

  const review = await call(`/api/cards/${cardId}/review`, {
    method: 'POST',
    body: { rating: 'good' },
  });
  assert.equal(review.response.status, 200);
  assert.equal(review.payload.card.reviewCount, 1);
  assert.equal(review.payload.card.lastRating, 'good');
  assert.ok(review.payload.card.dueAt > Date.now());

  const afterReview = await call(`/api/decks/${deckId}`);
  assert.equal(afterReview.payload.deck.dueCount, 0);
});

test('downloads cards as CSV and JSON', async () => {
  const decks = await call('/api/decks');
  const deck = decks.payload.decks.find((item) => item.title === 'Botany');
  const csv = await call(`/api/decks/${deck.id}/export?format=csv`);
  assert.equal(csv.response.status, 200);
  assert.match(csv.response.headers.get('content-disposition'), /botany\.csv/);
  assert.match(csv.payload, /What is xylem\?/);

  const jsonExport = await call(`/api/decks/${deck.id}/export?format=json`);
  assert.equal(jsonExport.response.status, 200);
  assert.equal(jsonExport.payload.deck.cards[0].front, 'What is xylem?');
});

test('blocks cross-site writes and isolates accounts', async () => {
  const blocked = await call('/api/decks', {
    method: 'POST',
    body: { title: 'Blocked' },
    origin: 'https://attacker.example',
  });
  assert.equal(blocked.response.status, 403);

  const firstDecks = await call('/api/decks');
  const privateDeckId = firstDecks.payload.decks[0].id;
  const second = await call('/api/auth/register', {
    method: 'POST',
    body: { name: 'Moss Reed', email: 'moss@example.com', password: 'another safe password' },
    session: null,
  });
  const secondCookie = second.response.headers.get('set-cookie').split(';')[0];
  const hiddenDeck = await call(`/api/decks/${privateDeckId}`, { session: secondCookie });
  assert.equal(hiddenDeck.response.status, 404);
});

test('persists a dark theme and supports sign out/sign in', async () => {
  const theme = await call('/api/preferences', { method: 'PATCH', body: { theme: 'purple' } });
  assert.equal(theme.payload.theme, 'purple');
  const bootstrap = await call('/api/bootstrap');
  assert.equal(bootstrap.payload.theme, 'purple');

  const logout = await call('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal(logout.response.status, 204);
  cookie = null;
  const signedOut = await call('/api/bootstrap', { session: null });
  assert.equal(signedOut.response.status, 401);

  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'aster@example.com', password: 'correct horse petal' },
    session: null,
  });
  assert.equal(login.response.status, 200);
  cookie = login.response.headers.get('set-cookie').split(';')[0];
});
