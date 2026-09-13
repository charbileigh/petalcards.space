export function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function reportApiError(error: unknown, fallback: string) {
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}

export function notSignedIn() {
  return Response.json({ error: "Please sign in to continue." }, { status: 401 });
}

export function notFound(label = "Item") {
  return Response.json({ error: `${label} not found.` }, { status: 404 });
}
