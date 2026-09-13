import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";
import { AppHeader } from "@/components/app-header";
import { Dashboard } from "@/components/dashboard";
import { WelcomeScreen } from "@/components/welcome-screen";
import { listDecks } from "@/lib/data";
import type { DeckSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) {
    return <WelcomeScreen signInPath={chatGPTSignInPath("/")} />;
  }

  let decks: DeckSummary[] = [];
  let loadError = "";
  try {
    decks = await listDecks(user.userId);
  } catch (error) {
    console.error("Unable to load decks", error);
    loadError = "Your decks are safe, but they could not be loaded just now. Please refresh and try again.";
  }

  return (
    <div className="app-shell">
      <AppHeader user={user} signOutPath={chatGPTSignOutPath("/")} />
      <Dashboard initialDecks={decks} displayName={user.displayName} initialError={loadError} />
    </div>
  );
}
