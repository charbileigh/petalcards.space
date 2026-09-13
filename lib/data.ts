import "server-only";

import { and, asc, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { cardProgress, cards, decks } from "@/db/schema";

export async function listDecks(ownerId: string) {
  const db = getDb();
  return db
    .select({
      id: decks.id,
      title: decks.title,
      description: decks.description,
      cardCount: count(cards.id),
      createdAt: decks.createdAt,
      updatedAt: decks.updatedAt,
    })
    .from(decks)
    .leftJoin(cards, eq(cards.deckId, decks.id))
    .where(eq(decks.ownerId, ownerId))
    .groupBy(decks.id)
    .orderBy(desc(decks.updatedAt), asc(decks.title));
}

export async function getDeckForOwner(deckId: string, ownerId: string) {
  const db = getDb();
  const [deck] = await db
    .select({
      id: decks.id,
      title: decks.title,
      description: decks.description,
      createdAt: decks.createdAt,
      updatedAt: decks.updatedAt,
    })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.ownerId, ownerId)))
    .limit(1);
  return deck ?? null;
}

export async function listCardsForDeck(deckId: string, ownerId: string) {
  const db = getDb();
  return db
    .select({
      id: cards.id,
      deckId: cards.deckId,
      front: cards.front,
      back: cards.back,
      position: cards.position,
      createdAt: cards.createdAt,
      updatedAt: cards.updatedAt,
    })
    .from(cards)
    .innerJoin(decks, eq(cards.deckId, decks.id))
    .where(and(eq(cards.deckId, deckId), eq(decks.ownerId, ownerId)))
    .orderBy(asc(cards.position), asc(cards.createdAt));
}

export async function listStudyCards(deckId: string, ownerId: string) {
  const db = getDb();
  return db
    .select({
      id: cards.id,
      deckId: cards.deckId,
      front: cards.front,
      back: cards.back,
      position: cards.position,
      createdAt: cards.createdAt,
      updatedAt: cards.updatedAt,
      lastRating: cardProgress.lastRating,
      intervalDays: cardProgress.intervalDays,
      dueAt: cardProgress.dueAt,
      reviewCount: cardProgress.reviewCount,
    })
    .from(cards)
    .innerJoin(decks, eq(cards.deckId, decks.id))
    .leftJoin(cardProgress, eq(cardProgress.cardId, cards.id))
    .where(and(eq(cards.deckId, deckId), eq(decks.ownerId, ownerId)))
    .orderBy(asc(cards.position), asc(cards.createdAt));
}

export async function getOwnedCard(cardId: string, ownerId: string) {
  const db = getDb();
  const [card] = await db
    .select({
      id: cards.id,
      deckId: cards.deckId,
      front: cards.front,
      back: cards.back,
      position: cards.position,
      createdAt: cards.createdAt,
      updatedAt: cards.updatedAt,
    })
    .from(cards)
    .innerJoin(decks, eq(cards.deckId, decks.id))
    .where(and(eq(cards.id, cardId), eq(decks.ownerId, ownerId)))
    .limit(1);
  return card ?? null;
}
