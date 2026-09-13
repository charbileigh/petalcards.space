import { eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { cards, decks } from "@/db/schema";
import {
  cleanText,
  notFound,
  notSignedIn,
  reportApiError,
} from "@/lib/api";
import { getOwnedCard } from "@/lib/data";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return notSignedIn();
  const { id } = await context.params;

  try {
    const current = await getOwnedCard(id, user.userId);
    if (!current) return notFound("Card");

    const payload = (await request.json()) as Record<string, unknown>;
    const front = payload.front === undefined ? current.front : cleanText(payload.front, 2000);
    const back = payload.back === undefined ? current.back : cleanText(payload.back, 2000);
    if (!front || !back) {
      return Response.json(
        { error: "Each card needs both a front and a back." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [card] = await db
      .update(cards)
      .set({ front, back, updatedAt: Date.now() })
      .where(eq(cards.id, id))
      .returning();
    await db
      .update(decks)
      .set({ updatedAt: Date.now() })
      .where(eq(decks.id, current.deckId));

    return Response.json({ card });
  } catch (error) {
    return reportApiError(error, "The card could not be updated.");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return notSignedIn();
  const { id } = await context.params;

  try {
    const current = await getOwnedCard(id, user.userId);
    if (!current) return notFound("Card");
    const db = getDb();
    await db.delete(cards).where(eq(cards.id, id));
    await db
      .update(decks)
      .set({ updatedAt: Date.now() })
      .where(eq(decks.id, current.deckId));
    return Response.json({ deleted: true });
  } catch (error) {
    return reportApiError(error, "The card could not be deleted.");
  }
}
