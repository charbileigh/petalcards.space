import { ArrowRight, Download, Sparkles } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemePicker } from "@/components/theme-picker";

export function WelcomeScreen({ signInPath }: { signInPath: string }) {
  return (
    <main className="welcome-shell">
      <header className="welcome-header">
        <Brand />
        <ThemePicker />
      </header>

      <section className="welcome-grid">
        <div className="welcome-copy">
          <p className="eyebrow">Your study space</p>
          <h1>Small cards.<br />Big things remembered.</h1>
          <p className="welcome-intro">
            Build tidy decks, study one idea at a time, and keep your progress saved wherever you sign in.
          </p>
          <a href={signInPath} target="_top" className="primary-link">
            Sign in with ChatGPT <ArrowRight aria-hidden="true" />
          </a>
          <p className="auth-note">
            Your ChatGPT account keeps your decks private to you. Petalcards cannot read your chats.
          </p>
          <div className="welcome-benefits" aria-label="Petalcards features">
            <span><Sparkles /> Remember your study progress</span>
            <span><Download /> Export any deck as CSV or JSON</span>
          </div>
        </div>

        <div className="welcome-demo" aria-label="Example flashcard">
          <div className="demo-card demo-card-back" aria-hidden="true" />
          <article className="demo-card demo-card-front">
            <div className="demo-card-topline">
              <span>Software quality</span>
              <span>1 / 12</span>
            </div>
            <div className="demo-card-question">
              <small>Question</small>
              <p>What is the purpose of regression testing?</p>
            </div>
            <div className="demo-card-hint">Tap to reveal the answer</div>
          </article>
          <span className="petal-sticker">make it stick</span>
        </div>
      </section>
    </main>
  );
}
