import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { newId } from './security.mjs';

const THEMES = new Set(['pink', 'purple', 'blue', 'green', 'berry', 'grey']);
const ACCENTS = new Set(['rose', 'peach', 'lilac', 'sky', 'mint', 'berry']);

function userView(row) {
  return row ? {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  } : null;
}

function deckView(row) {
  return row ? {
    id: row.id,
    title: row.title,
    description: row.description,
    accent: row.accent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cardCount: Number(row.card_count ?? 0),
    dueCount: Number(row.due_count ?? 0),
    mastery: Number(row.mastery ?? 0),
  } : null;
}

function cardView(row) {
  return row ? {
    id: row.id,
    deckId: row.deck_id,
    front: row.front,
    back: row.back,
    hint: row.hint,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dueAt: row.due_at ?? null,
    intervalDays: Number(row.interval_days ?? 0),
    reviewCount: Number(row.review_count ?? 0),
    correctCount: Number(row.correct_count ?? 0),
    lastRating: row.last_rating ?? null,
  } : null;
}

export class PetalDatabase {
  constructor(path = './data/petalcards.sqlite') {
    const dbPath = path === ':memory:' ? path : resolve(path);
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (dbPath !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        theme TEXT NOT NULL DEFAULT 'pink'
      );

      CREATE TABLE IF NOT EXISTS decks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        accent TEXT NOT NULL DEFAULT 'rose',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS decks_user_idx ON decks(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        hint TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cards_deck_idx ON cards(deck_id, position, created_at);

      CREATE TABLE IF NOT EXISTS card_progress (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        interval_days REAL NOT NULL DEFAULT 0,
        ease REAL NOT NULL DEFAULT 2.5,
        due_at INTEGER NOT NULL,
        last_rating TEXT,
        review_count INTEGER NOT NULL DEFAULT 0,
        correct_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, card_id)
      );
      CREATE INDEX IF NOT EXISTS progress_due_idx ON card_progress(user_id, due_at);
    `);
  }

  close() {
    this.db.close();
  }

  createUser({ name, email, passwordHash }) {
    const id = newId();
    const now = Date.now();
    this.db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, email, passwordHash, now);
    this.db.prepare('INSERT INTO preferences (user_id, theme) VALUES (?, ?)').run(id, 'pink');
    return userView(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }

  getUserByEmail(email) {
    return this.db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) ?? null;
  }

  getUser(id) {
    return userView(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }

  updateProfile(userId, name) {
    this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
    return this.getUser(userId);
  }

  updatePassword(userId, passwordHash) {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  deleteAccount(userId) {
    return this.db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0;
  }

  createSession(tokenHash, userId, expiresAt) {
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, Date.now(), expiresAt);
  }

  getSession(tokenHash) {
    const row = this.db.prepare(`
      SELECT s.token_hash, s.expires_at, u.id, u.name, u.email, u.created_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(tokenHash, Date.now());
    return row ? { tokenHash: row.token_hash, expiresAt: row.expires_at, user: userView(row) } : null;
  }

  deleteSession(tokenHash) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  deleteExpiredSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  }

  getTheme(userId) {
    return this.db.prepare('SELECT theme FROM preferences WHERE user_id = ?').get(userId)?.theme ?? 'pink';
  }

  setTheme(userId, theme) {
    const value = THEMES.has(theme) ? theme : 'pink';
    this.db.prepare(`
      INSERT INTO preferences (user_id, theme) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme
    `).run(userId, value);
    return value;
  }

  listDecks(userId) {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT d.*,
        COUNT(c.id) AS card_count,
        COALESCE(SUM(CASE WHEN c.id IS NOT NULL AND (p.due_at IS NULL OR p.due_at <= ?) THEN 1 ELSE 0 END), 0) AS due_count,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN p.interval_days >= 21 THEN 1 ELSE 0 END) / NULLIF(COUNT(c.id), 0)), 0) AS mastery
      FROM decks d
      LEFT JOIN cards c ON c.deck_id = d.id
      LEFT JOIN card_progress p ON p.card_id = c.id AND p.user_id = d.user_id
      WHERE d.user_id = ?
      GROUP BY d.id
      ORDER BY d.updated_at DESC
    `).all(now, userId);
    return rows.map(deckView);
  }

  dashboardStats(userId) {
    const decks = this.listDecks(userId);
    return {
      decks: decks.length,
      cards: decks.reduce((total, deck) => total + deck.cardCount, 0),
      due: decks.reduce((total, deck) => total + deck.dueCount, 0),
      mastery: decks.length ? Math.round(decks.reduce((total, deck) => total + deck.mastery, 0) / decks.length) : 0,
    };
  }

  createDeck(userId, { title, description = '', accent = 'rose' }) {
    const id = newId();
    const now = Date.now();
    const safeAccent = ACCENTS.has(accent) ? accent : 'rose';
    this.db.prepare(`
      INSERT INTO decks (id, user_id, title, description, accent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, title, description, safeAccent, now, now);
    return this.getDeck(userId, id, false);
  }

  getDeck(userId, deckId, includeCards = true) {
    const now = Date.now();
    const row = this.db.prepare(`
      SELECT d.*,
        COUNT(c.id) AS card_count,
        COALESCE(SUM(CASE WHEN c.id IS NOT NULL AND (p.due_at IS NULL OR p.due_at <= ?) THEN 1 ELSE 0 END), 0) AS due_count,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN p.interval_days >= 21 THEN 1 ELSE 0 END) / NULLIF(COUNT(c.id), 0)), 0) AS mastery
      FROM decks d
      LEFT JOIN cards c ON c.deck_id = d.id
      LEFT JOIN card_progress p ON p.card_id = c.id AND p.user_id = d.user_id
      WHERE d.id = ? AND d.user_id = ?
      GROUP BY d.id
    `).get(now, deckId, userId);
    if (!row) return null;
    const deck = deckView(row);
    if (includeCards) {
      deck.cards = this.db.prepare(`
        SELECT c.*, p.due_at, p.interval_days, p.review_count, p.correct_count, p.last_rating
        FROM cards c
        LEFT JOIN card_progress p ON p.card_id = c.id AND p.user_id = ?
        WHERE c.deck_id = ?
        ORDER BY c.position, c.created_at
      `).all(userId, deckId).map(cardView);
    }
    return deck;
  }

  updateDeck(userId, deckId, { title, description, accent }) {
    const current = this.db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
    if (!current) return null;
    const nextAccent = accent === undefined ? current.accent : (ACCENTS.has(accent) ? accent : current.accent);
    this.db.prepare(`
      UPDATE decks SET title = ?, description = ?, accent = ?, updated_at = ? WHERE id = ? AND user_id = ?
    `).run(title ?? current.title, description ?? current.description, nextAccent, Date.now(), deckId, userId);
    return this.getDeck(userId, deckId, false);
  }

  deleteDeck(userId, deckId) {
    return this.db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').run(deckId, userId).changes > 0;
  }

  createCard(userId, deckId, { front, back, hint = '' }) {
    const owned = this.db.prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
    if (!owned) return null;
    const position = Number(this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM cards WHERE deck_id = ?').get(deckId)?.next ?? 0);
    const id = newId();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO cards (id, deck_id, front, back, hint, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, deckId, front, back, hint, position, now, now);
    this.db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(now, deckId);
    return cardView(this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id));
  }

  updateCard(userId, cardId, { front, back, hint }) {
    const current = this.db.prepare(`
      SELECT c.* FROM cards c JOIN decks d ON d.id = c.deck_id WHERE c.id = ? AND d.user_id = ?
    `).get(cardId, userId);
    if (!current) return null;
    const now = Date.now();
    this.db.prepare('UPDATE cards SET front = ?, back = ?, hint = ?, updated_at = ? WHERE id = ?')
      .run(front ?? current.front, back ?? current.back, hint ?? current.hint, now, cardId);
    this.db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(now, current.deck_id);
    return cardView(this.db.prepare(`
      SELECT c.*, p.due_at, p.interval_days, p.review_count, p.correct_count, p.last_rating
      FROM cards c LEFT JOIN card_progress p ON p.card_id = c.id AND p.user_id = ? WHERE c.id = ?
    `).get(userId, cardId));
  }

  deleteCard(userId, cardId) {
    const current = this.db.prepare(`
      SELECT c.deck_id FROM cards c JOIN decks d ON d.id = c.deck_id WHERE c.id = ? AND d.user_id = ?
    `).get(cardId, userId);
    if (!current) return false;
    this.db.prepare('DELETE FROM cards WHERE id = ?').run(cardId);
    this.db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(Date.now(), current.deck_id);
    return true;
  }

  reviewCard(userId, cardId, rating) {
    const card = this.db.prepare(`
      SELECT c.* FROM cards c JOIN decks d ON d.id = c.deck_id WHERE c.id = ? AND d.user_id = ?
    `).get(cardId, userId);
    if (!card) return null;
    const current = this.db.prepare('SELECT * FROM card_progress WHERE user_id = ? AND card_id = ?').get(userId, cardId);
    const now = Date.now();
    let ease = Number(current?.ease ?? 2.5);
    let interval = Number(current?.interval_days ?? 0);

    if (rating === 'again') {
      interval = 10 / (24 * 60);
      ease = Math.max(1.3, ease - 0.2);
    } else if (rating === 'hard') {
      interval = interval < 1 ? 1 : Math.max(1, interval * 1.2);
      ease = Math.max(1.3, ease - 0.15);
    } else if (rating === 'good') {
      interval = interval < 1 ? 1 : Math.max(1, interval * ease);
    } else {
      interval = interval < 1 ? 4 : Math.max(4, interval * ease * 1.3);
      ease = Math.min(3.2, ease + 0.15);
    }

    const dueAt = now + Math.round(interval * 24 * 60 * 60 * 1000);
    const correct = rating === 'good' || rating === 'easy' ? 1 : 0;
    this.db.prepare(`
      INSERT INTO card_progress
        (user_id, card_id, interval_days, ease, due_at, last_rating, review_count, correct_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(user_id, card_id) DO UPDATE SET
        interval_days = excluded.interval_days,
        ease = excluded.ease,
        due_at = excluded.due_at,
        last_rating = excluded.last_rating,
        review_count = card_progress.review_count + 1,
        correct_count = card_progress.correct_count + excluded.correct_count,
        updated_at = excluded.updated_at
    `).run(userId, cardId, interval, ease, dueAt, rating, correct, now);
    return cardView(this.db.prepare(`
      SELECT c.*, p.due_at, p.interval_days, p.review_count, p.correct_count, p.last_rating
      FROM cards c JOIN card_progress p ON p.card_id = c.id AND p.user_id = ? WHERE c.id = ?
    `).get(userId, cardId));
  }

  seedStarterDeck(userId) {
    const deck = this.createDeck(userId, {
      title: 'Welcome to Petalcards',
      description: 'A tiny starter deck — edit it, study it, or delete it whenever you like.',
      accent: 'rose',
    });
    const cards = [
      ['What makes a memory stick?', 'Active recall and spaced repetition.', 'Try answering before you flip.'],
      ['What does “again” do?', 'It brings the card back soon so you can retry it.', 'Use it when the answer did not come to mind.'],
      ['Can I download my cards?', 'Yes — export any deck as CSV or JSON.', 'Look in the deck menu.'],
    ];
    for (const [front, back, hint] of cards) this.createCard(userId, deck.id, { front, back, hint });
    return this.getDeck(userId, deck.id);
  }
}

export function defaultDatabasePath() {
  return process.env.PETALCARDS_DB_PATH || `${process.env.DATA_DIR || './data'}/petalcards.sqlite`;
}

export const allowedThemes = THEMES;
export const allowedAccents = ACCENTS;
