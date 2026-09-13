import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { decks } from "@/db/schema";
import {
  cleanText,
  notFound,
  notSignedIn,
  reportApiError,
} from "@/lib/api";
import { getDeckForOwner } from "@/lib/data";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return notSignedIn();
  const { id } = await context.params;

  try {
    const current = await getDeckForOwner(id, user.userId);
    if (!current) return notFound("Deck");

    const payload = (await request.json()) as Record<string, unknown>;
    const title = payload.title === undefined ? current.title : cleanText(payload.title, 100);
    const description =
      payload.description === undefined
        ? current.description
        : cleanText(payload.description, 500);

    if (!title) {
      return Response.json({ error: "Give your deck a title." }, { status: 400 });
    }

    const [deck] = await getDb()
      .update(decks)
      .set({ title, description, updatedAt: Date.now() })
      .where(and(eq(decks.id, id), eq(decks.ownerId, user.userId)))
      .returning({
        id: decks.id,
        title: decks.title,
        description: decks.description,
        createdAt: decks.createdAt,
        updatedAt: decks.updatedAt,
      });

    return Response.json({ deck });
  } catch (error) {
    return reportApiError(error, "Your deck could not be updated.");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return notSignedIn();
  const { id } = await context.params;

  try {
    const result = await getDb()
      .delete(decks)
      .where(and(eq(decks.id, id), eq(decks.ownerId, user.userId)))
      .returning({ id: decks.id });

    if (!result.length) return notFound("Deck");
    return Response.json({ deleted: true });
  } catch (error) {
    return reportApiError(error, "Your deck could not be deleted.");
  }
}
