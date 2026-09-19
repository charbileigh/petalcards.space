import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PetalDatabase, allowedAccents, allowedThemes, defaultDatabasePath } from './database.mjs';
import {
  clearSessionCookie,
  createSessionToken,
  csvCell,
  hashPassword,
  hashSessionToken,
  makeSessionCookie,
  normalizeEmail,
  parseCookies,
  safeFilename,
  validEmail,
  verifyPassword,
} from './security.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const GUEST_SECONDS = 60 * 60 * 24 * 365;
const JSON_LIMIT = 1_000_000;
const RATINGS = new Set(['again', 'hard', 'good', 'easy']);
const loginAttempts = new Map();

class AppError extends Error {
  constructor(status, message, code = 'request_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function baseHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
    ...extra,
  };
}

function json(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, baseHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  }));
  response.end(body);
}

function empty(response, status = 204, headers = {}) {
  response.writeHead(status, baseHeaders({ 'Cache-Control': 'no-store', ...headers }));
  response.end();
}

async function readJson(request) {
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) throw new AppError(415, 'Send this request as JSON.', 'content_type');
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > JSON_LIMIT) throw new AppError(413, 'That request is too large.', 'too_large');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new AppError(413, 'That request is too large.', 'too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'The JSON body is invalid.', 'invalid_json');
  }
}

function cleanText(value, field, { min = 0, max = 5_000 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min) throw new AppError(400, `${field} is required.`, 'validation');
  if (text.length > max) throw new AppError(400, `${field} must be ${max} characters or fewer.`, 'validation');
  return text;
}

function requestIp(request) {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return request.socket.remoteAddress || 'unknown';
}

function checkAuthRateLimit(request) {
  const key = requestIp(request);
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > 15) throw new AppError(429, 'Too many sign-in attempts. Try again in a few minutes.', 'rate_limited');
}

function clearAuthRateLimit(request) {
  loginAttempts.delete(requestIp(request));
}

function assertSameOrigin(request) {
  if (String(request.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') {
    throw new AppError(403, 'Cross-site requests are not allowed.', 'origin');
  }
  const origin = request.headers.origin;
  if (!origin) return;
  const configured = process.env.APP_ORIGIN?.replace(/\/$/, '');
  if (configured && origin === configured) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError(403, 'Invalid request origin.', 'origin');
  }
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '').split(',')[0].trim();
  const expectedHost = forwardedHost || request.headers.host;
  if (!expectedHost || originHost !== expectedHost) throw new AppError(403, 'Cross-site requests are not allowed.', 'origin');
}

function authenticate(request, db, required = true) {
  const cookies = parseCookies(request.headers.cookie);
  const session = [cookies.petalcards_session, cookies.petalcards_guest]
    .filter(Boolean).map((token) => db.getSession(hashSessionToken(token))).find(Boolean);
  if (!session && required) throw new AppError(401, 'Please sign in to continue.', 'unauthorized');
  return session;
}

function createLogin(db, userId, request) {
  const token = createSessionToken();
  db.createSession(hashSessionToken(token), userId, Date.now() + SESSION_SECONDS * 1000);
  return makeSessionCookie(token, request, SESSION_SECONDS);
}

function bootstrap(db, user) {
  return {
    user,
    theme: db.getTheme(user.id),
    decks: db.listDecks(user.id),
    stats: db.dashboardStats(user.id),
  };
}

function mimeType(path) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  }[extname(path)] ?? 'application/octet-stream';
}

function serveFile(response, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const stat = statSync(filePath);
  response.writeHead(200, baseHeaders({
    'Content-Type': mimeType(filePath),
    'Content-Length': stat.size,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
  }));
  createReadStream(filePath).pipe(response);
  return true;
}

function exportDeck(response, deck, format) {
  const filename = safeFilename(deck.title);
  if (format === 'json') {
    const body = JSON.stringify({
      exportedAt: new Date().toISOString(),
      deck: {
        title: deck.title,
        description: deck.description,
        cards: deck.cards.map(({ front, back, hint }) => ({ front, back, hint })),
      },
    }, null, 2);
    response.writeHead(200, baseHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.json"`,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    }));
    response.end(body);
    return;
  }
  const lines = [
    ['Front', 'Back', 'Hint'].map(csvCell).join(','),
    ...deck.cards.map((card) => [card.front, card.back, card.hint].map(csvCell).join(',')),
  ];
  const body = `\uFEFF${lines.join('\r\n')}`;
  response.writeHead(200, baseHeaders({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}.csv"`,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  }));
  response.end(body);
}

async function api(request, response, url, db) {
  const method = request.method ?? 'GET';
  const path = url.pathname;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) assertSameOrigin(request);

  if (method === 'GET' && path === '/api/health') {
    return json(response, 200, { ok: true, service: 'petalcards' });
  }

  if (method === 'POST' && path === '/api/guest') {
    const existing = authenticate(request, db, false);
    if (existing) return json(response, 200, bootstrap(db, existing.user));
    checkAuthRateLimit(request);
    const token = createSessionToken();
    // An unguessable cookie identifies this browser's private workspace.
    // Guest records cannot be signed into using a password.
    const user = db.createUser({ name: 'Petal', email: `${createSessionToken()}@guest.invalid`, passwordHash: '' });
    db.seedStarterDeck(user.id);
    db.createSession(hashSessionToken(token), user.id, Date.now() + GUEST_SECONDS * 1000);
    const cookie = makeSessionCookie(token, request, GUEST_SECONDS).replace('petalcards_session=', 'petalcards_guest=');
    return json(response, 201, bootstrap(db, user), { 'Set-Cookie': cookie });
  }

  if (method === 'POST' && path === '/api/auth/register') {
    if (process.env.ALLOW_REGISTRATION === 'false') throw new AppError(403, 'New account registration is currently closed.', 'registration_closed');
    checkAuthRateLimit(request);
    const body = await readJson(request);
    const name = cleanText(body.name, 'Name', { min: 1, max: 60 });
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? '');
    if (!validEmail(email)) throw new AppError(400, 'Enter a valid email address.', 'validation');
    if (password.length < 8 || password.length > 128) throw new AppError(400, 'Password must be between 8 and 128 characters.', 'validation');
    if (db.getUserByEmail(email)) throw new AppError(409, 'An account with that email already exists.', 'email_exists');
    const user = db.createUser({ name, email, passwordHash: await hashPassword(password) });
    db.seedStarterDeck(user.id);
    clearAuthRateLimit(request);
    return json(response, 201, bootstrap(db, user), { 'Set-Cookie': createLogin(db, user.id, request) });
  }

  if (method === 'POST' && path === '/api/auth/login') {
    checkAuthRateLimit(request);
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? '');
    const record = db.getUserByEmail(email);
    if (!record || !(await verifyPassword(password, record.password_hash))) {
      throw new AppError(401, 'Email or password is incorrect.', 'invalid_credentials');
    }
    clearAuthRateLimit(request);
    const user = db.getUser(record.id);
    return json(response, 200, bootstrap(db, user), { 'Set-Cookie': createLogin(db, user.id, request) });
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    const token = parseCookies(request.headers.cookie).petalcards_session;
    if (token) db.deleteSession(hashSessionToken(token));
    return empty(response, 204, { 'Set-Cookie': clearSessionCookie(request) });
  }

  if (method === 'GET' && path === '/api/bootstrap') {
    const { user } = authenticate(request, db);
    const headers = {};
    if (user.guest) {
      const token = parseCookies(request.headers.cookie).petalcards_guest;
      db.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
        .run(Date.now() + GUEST_SECONDS * 1000, hashSessionToken(token));
      headers['Set-Cookie'] = makeSessionCookie(token, request, GUEST_SECONDS).replace('petalcards_session=', 'petalcards_guest=');
    }
    return json(response, 200, bootstrap(db, user), headers);
  }

  if (method === 'PATCH' && path === '/api/preferences') {
    const { user } = authenticate(request, db);
    const body = await readJson(request);
    if (!allowedThemes.has(body.theme)) throw new AppError(400, 'Choose a valid theme.', 'validation');
    return json(response, 200, { theme: db.setTheme(user.id, body.theme) });
  }

  if (method === 'PATCH' && path === '/api/account') {
    const { user } = authenticate(request, db);
    const body = await readJson(request);
    const name = cleanText(body.name, 'Name', { min: 1, max: 60 });
    return json(response, 200, { user: db.updateProfile(user.id, name) });
  }

  if (method === 'POST' && path === '/api/account/password') {
    const { user } = authenticate(request, db);
    const body = await readJson(request);
    const currentPassword = String(body.currentPassword ?? '');
    const newPassword = String(body.newPassword ?? '');
    if (user.guest) throw new AppError(403, 'This workspace has no password or account.', 'guest_workspace');
    const record = db.getUserByEmail(user.email);
    if (!(await verifyPassword(currentPassword, record.password_hash))) throw new AppError(403, 'Current password is incorrect.', 'invalid_password');
    if (newPassword.length < 8 || newPassword.length > 128) throw new AppError(400, 'New password must be between 8 and 128 characters.', 'validation');
    db.updatePassword(user.id, await hashPassword(newPassword));
    return empty(response, 204, { 'Set-Cookie': createLogin(db, user.id, request) });
  }

  if (method === 'DELETE' && path === '/api/account') {
    const { user } = authenticate(request, db);
    const body = await readJson(request);
    if (user.guest) throw new AppError(403, 'This workspace has no password or account.', 'guest_workspace');
    const record = db.getUserByEmail(user.email);
    if (!(await verifyPassword(String(body.password ?? ''), record.password_hash))) throw new AppError(403, 'Password is incorrect.', 'invalid_password');
    db.deleteAccount(user.id);
    return empty(response, 204, { 'Set-Cookie': clearSessionCookie(request) });
  }

  if (method === 'GET' && path === '/api/decks') {
    const { user } = authenticate(request, db);
    return json(response, 200, { decks: db.listDecks(user.id), stats: db.dashboardStats(user.id) });
  }

  if (method === 'POST' && path === '/api/decks') {
    const { user } = authenticate(request, db);
    const body = await readJson(request);
    const title = cleanText(body.title, 'Deck title', { min: 1, max: 120 });
    const description = cleanText(body.description, 'Description', { max: 500 });
    const accent = allowedAccents.has(body.accent) ? body.accent : 'rose';
    return json(response, 201, { deck: db.createDeck(user.id, { title, description, accent }) });
  }

  const exportMatch = path.match(/^\/api\/decks\/([^/]+)\/export$/);
  if (method === 'GET' && exportMatch) {
    const { user } = authenticate(request, db);
    const deck = db.getDeck(user.id, decodeURIComponent(exportMatch[1]));
    if (!deck) throw new AppError(404, 'Deck not found.', 'not_found');
    const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
    return exportDeck(response, deck, format);
  }

  const cardCreateMatch = path.match(/^\/api\/decks\/([^/]+)\/cards$/);
  if (method === 'POST' && cardCreateMatch) {
    const { user } = authenticate(request, db);
    const body = await readJson(request);
    const front = cleanText(body.front, 'Front', { min: 1, max: 5_000 });
    const back = cleanText(body.back, 'Back', { min: 1, max: 5_000 });
    const hint = cleanText(body.hint, 'Hint', { max: 1_000 });
    const card = db.createCard(user.id, decodeURIComponent(cardCreateMatch[1]), { front, back, hint });
    if (!card) throw new AppError(404, 'Deck not found.', 'not_found');
    return json(response, 201, { card });
  }

  const deckMatch = path.match(/^\/api\/decks\/([^/]+)$/);
  if (deckMatch) {
    const { user } = authenticate(request, db);
    const deckId = decodeURIComponent(deckMatch[1]);
    if (method === 'GET') {
      const deck = db.getDeck(user.id, deckId);
      if (!deck) throw new AppError(404, 'Deck not found.', 'not_found');
      return json(response, 200, { deck });
    }
    if (method === 'PATCH') {
      const body = await readJson(request);
      const values = {};
      if ('title' in body) values.title = cleanText(body.title, 'Deck title', { min: 1, max: 120 });
      if ('description' in body) values.description = cleanText(body.description, 'Description', { max: 500 });
      if ('accent' in body) {
        if (!allowedAccents.has(body.accent)) throw new AppError(400, 'Choose a valid accent.', 'validation');
        values.accent = body.accent;
      }
      const deck = db.updateDeck(user.id, deckId, values);
      if (!deck) throw new AppError(404, 'Deck not found.', 'not_found');
      return json(response, 200, { deck });
    }
    if (method === 'DELETE') {
      if (!db.deleteDeck(user.id, deckId)) throw new AppError(404, 'Deck not found.', 'not_found');
      return empty(response);
    }
  }

  const reviewMatch = path.match(/^\/api\/cards\/([^/]+)\/review$/);
  if (method === 'POST' && reviewMatch) {
    const { user } = authenticate(request, db);
    const body = await readJson(request);
    if (!RATINGS.has(body.rating)) throw new AppError(400, 'Choose a valid study rating.', 'validation');
    const card = db.reviewCard(user.id, decodeURIComponent(reviewMatch[1]), body.rating);
    if (!card) throw new AppError(404, 'Card not found.', 'not_found');
    return json(response, 200, { card });
  }

  const cardMatch = path.match(/^\/api\/cards\/([^/]+)$/);
  if (cardMatch) {
    const { user } = authenticate(request, db);
    const cardId = decodeURIComponent(cardMatch[1]);
    if (method === 'PATCH') {
      const body = await readJson(request);
      const values = {};
      if ('front' in body) values.front = cleanText(body.front, 'Front', { min: 1, max: 5_000 });
      if ('back' in body) values.back = cleanText(body.back, 'Back', { min: 1, max: 5_000 });
      if ('hint' in body) values.hint = cleanText(body.hint, 'Hint', { max: 1_000 });
      const card = db.updateCard(user.id, cardId, values);
      if (!card) throw new AppError(404, 'Card not found.', 'not_found');
      return json(response, 200, { card });
    }
    if (method === 'DELETE') {
      if (!db.deleteCard(user.id, cardId)) throw new AppError(404, 'Card not found.', 'not_found');
      return empty(response);
    }
  }

  throw new AppError(404, 'API route not found.', 'not_found');
}

export function createPetalCardsServer({ dbPath = defaultDatabasePath() } = {}) {
  const db = new PetalDatabase(dbPath);
  db.deleteExpiredSessions();
  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host || 'localhost';
      const url = new URL(request.url || '/', `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        await api(request, response, url, db);
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new AppError(405, 'Method not allowed.', 'method');
      const staticFiles = new Map([
        ['/app.js', join(PUBLIC_DIR, 'app.js')],
        ['/styles.css', join(PUBLIC_DIR, 'styles.css')],
        ['/favicon.svg', join(PUBLIC_DIR, 'favicon.svg')],
      ]);
      const selected = staticFiles.get(url.pathname);
      if (selected && serveFile(response, selected)) return;
      serveFile(response, join(PUBLIC_DIR, 'index.html'));
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof AppError) {
        json(response, error.status, { error: error.message, code: error.code });
        return;
      }
      console.error(error);
      json(response, 500, { error: 'Something went wrong on the server.', code: 'server_error' });
    }
  });
  return { server, db };
}

export async function startServer(options = {}) {
  const { server, db } = createPetalCardsServer(options);
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  await new Promise((resolveListen) => server.listen(port, host, resolveListen));
  return { server, db, address: server.address() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const instance = await startServer();
  const address = instance.address;
  console.log(`Petalcards is ready on http://${address.address}:${address.port}`);
  const shutdown = () => instance.server.close(() => {
    instance.db.close();
    process.exit(0);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
