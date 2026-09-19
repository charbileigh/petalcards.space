import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PetalDatabase, defaultDatabasePath } from './database.mjs';
import { hashSessionToken, parseCookies } from './security.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'; manifest-src 'self'",
  'Cache-Control': 'no-cache',
};

function json(response, status, value) {
  response.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function createPetalCardsServer({ dbPath = defaultDatabasePath() } = {}) {
  // Old SQLite data is used only for copying an already-authorized library to the device.
  // No accounts, sessions or server-side decks are created by the new application.
  let legacyDb;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed.' });
      if (url.pathname === '/api/health') return json(response, 200, { ok: true, service: 'petalcards', storage: 'device', version: '2.0.0' });
      if (url.pathname === '/api/legacy-library') {
        const origin = request.headers.origin;
        const expectedOrigin = process.env.APP_ORIGIN?.replace(/\/$/, '');
        if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== expectedOrigin && new URL(origin).host !== request.headers.host)) {
          return json(response, 403, { error: 'Cross-site requests are not allowed.' });
        }
        const cookies = parseCookies(request.headers.cookie);
        const tokens = [cookies.petalcards_session, cookies.petalcards_guest].filter(Boolean);
        const libraries = [];
        if (tokens.length && existsSync(dbPath)) {
          legacyDb ||= new PetalDatabase(dbPath);
          const seen = new Set();
          for (const token of tokens) {
            const session = legacyDb.getSession(hashSessionToken(token));
            if (!session || seen.has(session.user.id)) continue;
            seen.add(session.user.id);
            libraries.push({
              sourceId: session.user.id,
              decks: legacyDb.listDecks(session.user.id).map((deck) => legacyDb.getDeck(session.user.id, deck.id)),
            });
          }
        }
        return json(response, 200, { libraries });
      }
      if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Route not found.' });
      const path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const file = resolve(PUBLIC_DIR, `.${path}`);
      if (!file.startsWith(PUBLIC_DIR) || !TYPES[extname(file)] || !existsSync(file) || !statSync(file).isFile()) {
        return json(response, 404, { error: 'File not found.' });
      }
      response.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[extname(file)], 'Content-Length': statSync(file).size });
      if (request.method === 'HEAD') return response.end();
      createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      console.error(error);
      if (response.headersSent) response.destroy();
      else json(response, 500, { error: 'Could not load this resource.' });
    }
  });
  return { server, db: { close: () => legacyDb?.close() } };
}

export async function startServer(options = {}) {
  const { server, db } = createPetalCardsServer(options);
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolveListen(); });
  });
  return { server, db, address: server.address() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const instance = await startServer();
  console.log(`Petalcards is ready on http://${instance.address.address}:${instance.address.port}`);
  const shutdown = () => instance.server.close(() => { instance.db.close(); process.exit(0); });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
