import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { decks } from "@/db/schema";
import { cleanText, notSignedIn, reportApiError } from "@/lib/api";
import { listDecks } from "@/lib/data";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return notSignedIn();

  try {
    return Response.json({ decks: await listDecks(user.userId) });
  } catch (error) {
    return reportApiError(error, "Your decks could not be loaded.");
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return notSignedIn();

  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const title = cleanText(payload.title, 100);
    const description = cleanText(payload.description, 500);

    if (!title) {
      return Response.json({ error: "Give your deck a title." }, { status: 400 });
    }

    const now = Date.now();
    const [deck] = await getDb()
      .insert(decks)
      .values({
        id: crypto.randomUUID(),
        ownerId: user.userId,
        title,
        description,
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: decks.id,
        title: decks.title,
        description: decks.description,
        createdAt: decks.createdAt,
        updatedAt: decks.updatedAt,
      });

    return Response.json({ deck: { ...deck, cardCount: 0 } }, { status: 201 });
  } catch (error) {
    return reportApiError(error, "Your deck could not be created.");
  }
}
