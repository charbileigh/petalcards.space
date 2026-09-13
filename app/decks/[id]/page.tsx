import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { chatGPTSignOutPath, requireChatGPTUser } from "@/app/chatgpt-auth";
import { AppHeader } from "@/components/app-header";
import { DeckWorkspace } from "@/components/deck-workspace";
import { getDeckForOwner, listCardsForDeck } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit deck" };

type PageProps = { params: Promise<{ id: string }> };

export default async function DeckPage({ params }: PageProps) {
  const { id } = await params;
  return <DeckPageContent id={id} />;
}

async function DeckPageContent({ id }: { id: string }) {
  const user = await requireChatGPTUser(`/decks/${id}`);
  const deck = await getDeckForOwner(id, user.userId);
  if (!deck) notFound();
  const cards = await listCardsForDeck(id, user.userId);
  return (
    <div className="app-shell">
      <AppHeader user={user} signOutPath={chatGPTSignOutPath("/")} />
      <DeckWorkspace initialDeck={deck} initialCards={cards} />
    </div>
  );
}
