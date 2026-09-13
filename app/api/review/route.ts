import { eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { cardProgress } from "@/db/schema";
import { notFound, notSignedIn, reportApiError } from "@/lib/api";
import { getOwnedCard } from "@/lib/data";

const DAY = 86_400_000;
const ratings = ["again", "hard", "good", "easy"] as const;
type Rating = (typeof ratings)[number];

function nextInterval(rating: Rating, previous: number) {
  if (rating === "again") return 0;
  if (rating === "hard") return Math.max(1, Math.round(previous * 1.2));
  if (rating === "good") return previous ? Math.max(2, Math.round(previous * 2.2)) : 2;
  return previous ? Math.max(4, Math.round(previous * 3.2)) : 4;
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return notSignedIn();

  try {
    const payload = (await request.json()) as { cardId?: unknown; rating?: unknown };
    const cardId = typeof payload.cardId === "string" ? payload.cardId : "";
    const rating = ratings.includes(payload.rating as Rating)
      ? (payload.rating as Rating)
      : null;
    if (!cardId || !rating) {
      return Response.json({ error: "Choose a valid study rating." }, { status: 400 });
    }

    const card = await getOwnedCard(cardId, user.userId);
    if (!card) return notFound("Card");

    const db = getDb();
    const [previous] = await db
      .select()
      .from(cardProgress)
      .where(eq(cardProgress.cardId, cardId))
      .limit(1);
    const now = Date.now();
    const intervalDays = nextInterval(rating, previous?.intervalDays ?? 0);
    const dueAt = rating === "again" ? now + 10 * 60_000 : now + intervalDays * DAY;
    const values = {
      cardId,
      ownerId: user.userId,
      lastRating: rating,
      intervalDays,
      dueAt,
      reviewCount: (previous?.reviewCount ?? 0) + 1,
      reviewedAt: now,
    };

    await db
      .insert(cardProgress)
      .values(values)
      .onConflictDoUpdate({
        target: cardProgress.cardId,
        set: values,
      });

    return Response.json({ progress: values });
  } catch (error) {
    return reportApiError(error, "Your study progress could not be saved.");
  }
}
