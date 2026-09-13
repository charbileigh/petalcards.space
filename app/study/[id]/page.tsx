import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { chatGPTSignOutPath, requireChatGPTUser } from "@/app/chatgpt-auth";
import { AppHeader } from "@/components/app-header";
import { StudySession } from "@/components/study-session";
import { getDeckForOwner, listStudyCards } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Study" };

type PageProps = { params: Promise<{ id: string }> };

export default async function StudyPage({ params }: PageProps) {
  const { id } = await params;
  return <StudyPageContent id={id} />;
}

async function StudyPageContent({ id }: { id: string }) {
  const user = await requireChatGPTUser(`/study/${id}`);
  const deck = await getDeckForOwner(id, user.userId);
  if (!deck) notFound();
  const cards = await listStudyCards(id, user.userId);
  return (
    <div className="app-shell study-shell">
      <AppHeader user={user} signOutPath={chatGPTSignOutPath("/")} />
      <StudySession deck={deck} cards={cards} />
    </div>
  );
}
