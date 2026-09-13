import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const decks = sqliteTable(
  "decks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_decks_owner_updated").on(table.ownerId, table.updatedAt),
  ],
);

export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    deckId: text("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    front: text("front").notNull(),
    back: text("back").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_cards_deck_position").on(table.deckId, table.position)],
);

export const cardProgress = sqliteTable(
  "card_progress",
  {
    cardId: text("card_id")
      .primaryKey()
      .references(() => cards.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    lastRating: text("last_rating").notNull(),
    intervalDays: integer("interval_days").notNull().default(0),
    dueAt: integer("due_at").notNull(),
    reviewCount: integer("review_count").notNull().default(0),
    reviewedAt: integer("reviewed_at").notNull(),
  },
  (table) => [
    index("idx_card_progress_owner_due").on(table.ownerId, table.dueAt),
  ],
);
