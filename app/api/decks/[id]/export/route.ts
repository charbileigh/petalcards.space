import { getChatGPTUser } from "@/app/chatgpt-auth";
import { notFound, notSignedIn, reportApiError } from "@/lib/api";
import { getDeckForOwner, listCardsForDeck } from "@/lib/data";

type RouteContext = { params: Promise<{ id: string }> };

function csvCell(value: string) {
  const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function safeFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "petalcards-deck";
}

export async function GET(request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return notSignedIn();
  const { id } = await context.params;

  try {
    const deck = await getDeckForOwner(id, user.userId);
    if (!deck) return notFound("Deck");
    const cards = await listCardsForDeck(id, user.userId);
    const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
    const filename = safeFilename(deck.title);

    if (format === "json") {
      return new Response(
        JSON.stringify(
          {
            title: deck.title,
            description: deck.description,
            exportedAt: new Date().toISOString(),
            cards: cards.map(({ front, back }) => ({ front, back })),
          },
          null,
          2,
        ),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="${filename}.json"`,
          },
        },
      );
    }

    const csv = [
      "Front,Back",
      ...cards.map((card) => `${csvCell(card.front)},${csvCell(card.back)}`),
    ].join("\r\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}.csv"`,
      },
    });
  } catch (error) {
    return reportApiError(error, "This deck could not be downloaded.");
  }
}
