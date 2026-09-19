// Read-only bridge for libraries saved by Petalcards 1.x.
// All new cards are stored by public/storage.js on the user's device.
import { DatabaseSync } from 'node:sqlite';

export class PetalDatabase {
  constructor(path) {
    this.db = new DatabaseSync(path, { readOnly: true });
  }
  close() { this.db.close(); }
  getSession(tokenHash) {
    const row = this.db.prepare(`SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE token_hash = ? AND expires_at > ?`).get(tokenHash, Date.now());
    return row ? { user: { id: row.user_id } } : null;
  }
  listDecks(userId) {
    return this.db.prepare('SELECT id FROM decks WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
  }
  getDeck(userId, deckId) {
    const row = this.db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
    if (!row) return null;
    const cards = this.db.prepare(`SELECT c.*, p.due_at, p.interval_days, p.ease, p.review_count, p.correct_count, p.last_rating
      FROM cards c LEFT JOIN card_progress p ON p.card_id = c.id AND p.user_id = ?
      WHERE c.deck_id = ? ORDER BY c.position, c.created_at`).all(userId, deckId);
    return {
      title: row.title, description: row.description, accent: row.accent, createdAt: row.created_at,
      cards: cards.map((card) => ({
        front: card.front, back: card.back, hint: card.hint, createdAt: card.created_at,
        dueAt: card.due_at, intervalDays: card.interval_days ?? 0, ease: card.ease ?? 2.5,
        reviewCount: card.review_count ?? 0, correctCount: card.correct_count ?? 0, lastRating: card.last_rating,
      })),
    };
  }
}

export function defaultDatabasePath() {
  return process.env.PETALCARDS_DB_PATH || `${process.env.DATA_DIR || './data'}/petalcards.sqlite`;
}
