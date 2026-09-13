import { and, eq, max } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { cards as flashcards, decks } from "@/db/schema";
import {
  cleanText,
  notFound,
  notSignedIn,
  reportApiError,
} from "@/lib/api";
import { getDeckForOwner, listCardsForDeck } from "@/lib/data";

type RouteContext = { params: Promise<{ id: string }> };
type DraftCard = { front?: unknown; back?: unknown };

export async function GET(_request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return notSignedIn();
  const { id } = await context.params;

  try {
    const deck = await getDeckForOwner(id, user.userId);
    if (!deck) return notFound("Deck");
    return Response.json({ cards: await listCardsForDeck(id, user.userId) });
  } catch (error) {
    return reportApiError(error, "The cards could not be loaded.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return notSignedIn();
  const { id } = await context.params;

  try {
    const deck = await getDeckForOwner(id, user.userId);
    if (!deck) return notFound("Deck");

    const payload = (await request.json()) as DraftCard & { cards?: DraftCard[] };
    const drafts = Array.isArray(payload.cards) ? payload.cards.slice(0, 50) : [payload];
    const cleaned = drafts.map((card) => ({
      front: cleanText(card.front, 2000),
      back: cleanText(card.back, 2000),
    }));

    if (!cleaned.length || cleaned.some((card) => !card.front || !card.back)) {
      return Response.json(
        { error: "Each card needs both a front and a back." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [positionRow] = await db
      .select({ value: max(flashcards.position) })
      .from(flashcards)
      .where(eq(flashcards.deckId, id));
    const startingPosition = (positionRow?.value ?? -1) + 1;
    const now = Date.now();
    const values = cleaned.map((card, index) => ({
      id: crypto.randomUUID(),
      deckId: id,
      front: card.front,
      back: card.back,
      position: startingPosition + index,
      createdAt: now + index,
      updatedAt: now + index,
    }));

    const created = await db.insert(flashcards).values(values).returning();
    await db
      .update(decks)
      .set({ updatedAt: Date.now() })
      .where(and(eq(decks.id, id), eq(decks.ownerId, user.userId)));

    return Response.json({ cards: created }, { status: 201 });
  } catch (error) {
    return reportApiError(error, "The card could not be saved.");
  }
}
