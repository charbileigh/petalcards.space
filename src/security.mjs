import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const PASSWORD_BYTES = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, PASSWORD_BYTES, SCRYPT_OPTIONS);
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, salt, expectedText] = encoded.split('$');
    if (algorithm !== 'scrypt' || !salt || !expectedText) return false;
    const expected = Buffer.from(expectedText, 'base64url');
    const actual = Buffer.from(
      await scrypt(password, salt, expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: 64 * 1024 * 1024,
      }),
    );
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function newId() {
  return randomUUID();
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

export function makeSessionCookie(token, request, maxAgeSeconds = 60 * 60 * 24 * 30) {
  const forced = process.env.COOKIE_SECURE;
  const forwarded = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const secure = forced === 'true' || (forced !== 'false' && (forwarded === 'https' || request.socket.encrypted));
  return [
    `petalcards_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function clearSessionCookie(request) {
  return makeSessionCookie('', request, 0);
}

export function safeFilename(value) {
  return String(value || 'petalcards-deck')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80) || 'petalcards-deck';
}

export function csvCell(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
