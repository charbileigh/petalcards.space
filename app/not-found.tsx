import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemePicker } from "@/components/theme-picker";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="app-shell">
      <header className="welcome-header"><Brand /><ThemePicker /></header>
      <main className="page-container fatal-state">
        <p className="eyebrow">Card not found</p>
        <h1>This page slipped out of the deck.</h1>
        <p>It may have been deleted, or the link may be incomplete.</p>
        <Button asChild className="primary-button"><Link href="/"><ArrowLeft /> Back to my decks</Link></Button>
      </main>
    </div>
  );
}
