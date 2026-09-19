import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { startServer } from '../src/server.mjs';
import { hashSessionToken } from '../src/security.mjs';

let instance, baseUrl, directory, databasePath;
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'petalcards-test-'));
  databasePath = join(directory, 'old.sqlite');
  instance = await startServer({ host: '127.0.0.1', port: 0, dbPath: databasePath });
  baseUrl = `http://127.0.0.1:${instance.address.port}`;
});
after(async () => {
  await new Promise((resolve) => instance.server.close(resolve));
  instance.db.close();
  rmSync(directory, { recursive: true, force: true });
});

test('opens with no account and serves every offline/install asset with a real MIME type', async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /login-form|register-form|type="password"|type="email"/);
  assert.equal(page.headers.get('set-cookie'), null);
  assert.equal(existsSync(databasePath), false, 'opening the app must not create a server database');
  const resources = {
    '/app.js': 'text/javascript', '/storage.js': 'text/javascript', '/downloads.js': 'text/javascript',
    '/pwa.js': 'text/javascript', '/sw.js': 'text/javascript', '/styles.css': 'text/css',
    '/manifest.webmanifest': 'application/manifest+json', '/icons/icon-192.png': 'image/png', '/icons/icon-512.png': 'image/png',
  };
  for (const [path, type] of Object.entries(resources)) {
    const response = await fetch(baseUrl + path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type').startsWith(type), path);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  const missing = await fetch(baseUrl + '/missing.js');
  assert.equal(missing.status, 404, 'missing scripts must not return cached HTML');
  const manifest = await (await fetch(baseUrl + '/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) {
    const icon = readFileSync(new URL(`../public/icons/icon-${size}.png`, import.meta.url));
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
  }
});

test('old login, registration, guest creation and account routes are disabled', async () => {
  for (const path of ['/api/auth/login', '/api/auth/register', '/api/guest', '/api/account', '/api/decks']) {
    assert.equal((await fetch(baseUrl + path, { method: 'POST', body: '{}' })).status, 405);
  }
  const health = await (await fetch(baseUrl + '/api/health')).json();
  assert.equal(health.storage, 'device');
});

test('legacy recovery is read-only and restricted to an existing unexpired session', async () => {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE sessions (token_hash TEXT, user_id TEXT, expires_at INTEGER);
    CREATE TABLE decks (id TEXT, user_id TEXT, title TEXT, description TEXT, accent TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE cards (id TEXT, deck_id TEXT, front TEXT, back TEXT, hint TEXT, position INTEGER, created_at INTEGER);
    CREATE TABLE card_progress (user_id TEXT, card_id TEXT, due_at INTEGER, interval_days REAL, ease REAL, review_count INTEGER, correct_count INTEGER, last_rating TEXT);
    INSERT INTO users VALUES ('one'), ('two');
    INSERT INTO decks VALUES ('d1','one','My old cards','','rose',1,1), ('d2','two','Private to someone else','','rose',1,1);
    INSERT INTO cards VALUES ('c1','d1','Old question','Old answer','',0,1);
    INSERT INTO card_progress VALUES ('one','c1',123456,3,2.2,7,5,'good');
  `);
  const insert = db.prepare('INSERT INTO sessions VALUES (?, ?, ?)');
  insert.run(hashSessionToken('valid-token'), 'one', Date.now() + 60000);
  insert.run(hashSessionToken('expired-token'), 'two', Date.now() - 1);
  db.close();
  const before = readFileSync(databasePath);
  for (const cookie of ['', 'petalcards_session=invalid', 'petalcards_guest=expired-token']) {
    const result = await (await fetch(baseUrl + '/api/legacy-library', { headers: { Cookie: cookie } })).json();
    assert.deepEqual(result.libraries, []);
  }
  const response = await fetch(baseUrl + '/api/legacy-library', { headers: { Cookie: 'petalcards_session=valid-token' } });
  const { libraries } = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(libraries.length, 1);
  assert.equal(libraries[0].decks.length, 1);
  assert.equal(libraries[0].decks[0].cards[0].reviewCount, 7);
  assert.equal(libraries[0].decks[0].cards[0].ease, 2.2);
  assert.equal((await fetch(baseUrl + '/api/legacy-library', { headers: { Cookie: 'petalcards_session=valid-token', Origin: 'https://untrusted.example' } })).status, 403);
  assert.deepEqual(readFileSync(databasePath), before);
});
