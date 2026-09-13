"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { DeckRecord, StudyCard } from "@/lib/types";

const ratingOptions = [
  { value: "again", label: "Again", shortcut: "1", hint: "10 min" },
  { value: "hard", label: "Hard", shortcut: "2", hint: "1 day" },
  { value: "good", label: "Good", shortcut: "3", hint: "2+ days" },
  { value: "easy", label: "Easy", shortcut: "4", hint: "4+ days" },
] as const;

type Rating = (typeof ratingOptions)[number]["value"];

export function StudySession({ deck, cards }: { deck: DeckRecord; cards: StudyCard[] }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [complete, setComplete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<Record<Rating, number>>({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  });

  const current = cards[index];

  const rateCard = useCallback(
    async (rating: Rating) => {
      if (!current || saving || !revealed) return;
      setSaving(true);
      try {
        const response = await fetch("/api/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cardId: current.id, rating }),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(body.error || "Your progress could not be saved.");
        setResults((value) => ({ ...value, [rating]: value[rating] + 1 }));
        if (index >= cards.length - 1) {
          setComplete(true);
        } else {
          setIndex((value) => value + 1);
          setRevealed(false);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Your progress could not be saved.");
      } finally {
        setSaving(false);
      }
    },
    [cards.length, current, index, revealed, saving],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.code === "Space" && current && !complete) {
        event.preventDefault();
        setRevealed((value) => !value);
        return;
      }
      if (revealed && !complete) {
        const option = ratingOptions.find((item) => item.shortcut === event.key);
        if (option) void rateCard(option.value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [complete, current, rateCard, revealed]);

  function restart() {
    setIndex(0);
    setRevealed(false);
    setComplete(false);
    setResults({ again: 0, hard: 0, good: 0, easy: 0 });
  }

  if (!cards.length) {
    return (
      <main className="page-container study-empty">
        <span className="empty-stack"><Sparkles /></span>
        <h1>This deck needs a card first.</h1>
        <p>Add at least one front-and-back card, then come back to study it.</p>
        <Button asChild className="primary-button"><Link href={`/decks/${deck.id}`}>Add cards</Link></Button>
      </main>
    );
  }

  if (complete) {
    const remembered = results.good + results.easy;
    return (
      <main className="page-container session-complete">
        <div className="complete-badge"><Check /></div>
        <p className="eyebrow">Session complete</p>
        <h1>That deck is done for now.</h1>
        <p>You reviewed {cards.length} {cards.length === 1 ? "card" : "cards"}. {remembered} felt good or easy.</p>
        <div className="results-grid">
          {ratingOptions.map((option) => (
            <div key={option.value} className={`result-card result-${option.value}`}>
              <span>{results[option.value]}</span>
              <small>{option.label}</small>
            </div>
          ))}
        </div>
        <div className="complete-actions">
          <Button variant="outline" onClick={restart}><RotateCcw /> Study again</Button>
          <Button asChild className="primary-button"><Link href={`/decks/${deck.id}`}>Back to deck</Link></Button>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container study-session">
      <div className="study-topbar">
        <Link href={`/decks/${deck.id}`} className="back-link"><ArrowLeft /> Leave session</Link>
        <span>{deck.title}</span>
        <span>{index + 1} of {cards.length}</span>
      </div>
      <Progress value={((index + 1) / cards.length) * 100} className="study-progress" />

      <section className="study-stage" aria-live="polite">
        <button
          type="button"
          className={`study-card ${revealed ? "is-revealed" : ""}`}
          onClick={() => setRevealed((value) => !value)}
          aria-label={revealed ? "Showing answer. Tap to see the question." : "Showing question. Tap to reveal the answer."}
        >
          <span className="study-card-inner">
            <span className="study-card-face study-card-front">
              <small>Question</small>
              <strong>{current.front}</strong>
              <span>Tap to reveal</span>
            </span>
            <span className="study-card-face study-card-back">
              <small>Answer</small>
              <strong>{current.back}</strong>
              <span>How did that feel?</span>
            </span>
          </span>
        </button>
      </section>

      {!revealed ? (
        <div className="reveal-actions">
          <Button className="primary-button" size="lg" onClick={() => setRevealed(true)}>Show answer</Button>
          <span>or press <kbd>space</kbd></span>
        </div>
      ) : (
        <div className="rating-panel">
          <p>Choose how well you remembered</p>
          <div className="rating-grid">
            {ratingOptions.map((option) => (
              <Button
                key={option.value}
                variant="outline"
                className={`rating-button rating-${option.value}`}
                onClick={() => void rateCard(option.value)}
                disabled={saving}
              >
                <span><kbd>{option.shortcut}</kbd>{option.label}</span>
                <small>{option.hint}</small>
              </Button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
