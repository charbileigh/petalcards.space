"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Layers3,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DeckSummary } from "@/lib/types";

type ModelTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute(input: unknown): unknown | Promise<unknown>;
};

type ModelContext = {
  registerTool(tool: ModelTool, options?: { signal?: AbortSignal }): void | Promise<void>;
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

function firstName(name: string) {
  if (name.includes("@")) return "there";
  return name.trim().split(/\s+/)[0] || "there";
}

function relativeDate(timestamp: number) {
  return `Updated ${new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(timestamp)}`;
}

export function Dashboard({
  initialDecks,
  displayName,
  initialError,
}: {
  initialDecks: DeckSummary[];
  displayName: string;
  initialError?: string;
}) {
  const [decks, setDecks] = useState(initialDecks);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeckSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const visibleDecks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return decks;
    return decks.filter((deck) =>
      `${deck.title} ${deck.description}`.toLowerCase().includes(needle),
    );
  }, [decks, query]);

  const createDeck = useCallback(async (title: string, description = "") => {
    const response = await fetch("/api/decks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, description }),
    });
    const body = await responseJson<{ deck: DeckSummary }>(response);
    setDecks((current) => [body.deck, ...current]);
    return body.deck;
  }, []);

  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();

    const register = async () => {
      await modelContext.registerTool(
        {
          name: "list_flashcard_decks",
          title: "List flashcard decks",
          description: "List the signed-in user's visible Petalcards decks and card counts.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async () => ({
            decks: decks.map(({ id, title, description, cardCount }) => ({
              id,
              title,
              description,
              cardCount,
            })),
          }),
        },
        { signal: lifecycle.signal },
      );
      await modelContext.registerTool(
        {
          name: "create_flashcard_deck",
          title: "Create a flashcard deck",
          description: "Create and display a new empty Petalcards deck for the signed-in user.",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", minLength: 1, maxLength: 100 },
              description: { type: "string", maxLength: 500 },
            },
            required: ["title"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input) => {
            const value = input as { title?: unknown; description?: unknown };
            if (typeof value.title !== "string" || !value.title.trim()) {
              throw new Error("A deck title is required.");
            }
            const deck = await createDeck(
              value.title,
              typeof value.description === "string" ? value.description : "",
            );
            return { id: deck.id, title: deck.title, cardCount: 0 };
          },
        },
        { signal: lifecycle.signal },
      );
    };
    void register().catch((error) => console.error("WebMCP registration failed", error));
    return () => lifecycle.abort();
  }, [createDeck, decks]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const title = String(form.get("title") || "").trim();
    const description = String(form.get("description") || "").trim();
    if (!title) return;

    setSaving(true);
    try {
      await createDeck(title, description);
      formElement.reset();
      setDialogOpen(false);
      toast.success("Deck created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your deck could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDeck() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/decks/${deleteTarget.id}`, { method: "DELETE" });
      await responseJson<{ deleted: true }>(response);
      setDecks((current) => current.filter((deck) => deck.id !== deleteTarget.id));
      toast.success("Deck deleted");
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your deck could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="dashboard page-container">
      <section className="dashboard-heading">
        <div>
          <p className="eyebrow">Your study library</p>
          <h1>Welcome back, {firstName(displayName)}.</h1>
          <p>What would you like to remember next?</p>
        </div>
        <Button className="primary-button" size="lg" onClick={() => setDialogOpen(true)}>
          <Plus /> New deck
        </Button>
      </section>

      {initialError && <div className="error-banner" role="alert">{initialError}</div>}

      <section className="library-section" aria-labelledby="decks-heading">
        <div className="library-toolbar">
          <div>
            <h2 id="decks-heading">My decks</h2>
            <span>{decks.length} {decks.length === 1 ? "deck" : "decks"}</span>
          </div>
          <label className="search-box">
            <Search aria-hidden="true" />
            <span className="sr-only">Search decks</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your decks"
            />
          </label>
        </div>

        {visibleDecks.length ? (
          <div className="deck-grid">
            {visibleDecks.map((deck, index) => (
              <article className="deck-tile" key={deck.id} style={{ "--deck-index": index } as React.CSSProperties}>
                <div className="deck-paper-lines" aria-hidden="true" />
                <Link href={`/decks/${deck.id}`} className="deck-tile-main">
                  <span className="deck-icon"><Layers3 /></span>
                  <div className="deck-title-row">
                    <h3>{deck.title}</h3>
                    <ArrowUpRight aria-hidden="true" />
                  </div>
                  <p>{deck.description || "A fresh deck ready for your notes."}</p>
                  <div className="deck-meta">
                    <span>{deck.cardCount} {deck.cardCount === 1 ? "card" : "cards"}</span>
                    <span>{relativeDate(deck.updatedAt)}</span>
                  </div>
                </Link>
                <div className="deck-tile-actions">
                  {deck.cardCount > 0 ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`/study/${deck.id}`}><BookOpen /> Study</Link>
                    </Button>
                  ) : (
                    <span className="empty-deck-label">Add your first card</span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleteTarget(deck)}
                    aria-label={`Delete ${deck.title}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : query ? (
          <div className="empty-state compact-empty">
            <Search />
            <h3>No matching decks</h3>
            <p>Try a different word or clear your search.</p>
          </div>
        ) : (
          <button className="empty-state empty-state-button" onClick={() => setDialogOpen(true)}>
            <span className="empty-stack" aria-hidden="true"><Sparkles /></span>
            <h3>Create your first deck</h3>
            <p>Add a subject, fill it with cards, and start studying.</p>
            <span className="empty-action"><Plus /> New deck</span>
          </button>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="form-dialog">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Create a deck</DialogTitle>
              <DialogDescription>Give this set a clear name so it is easy to find later.</DialogDescription>
            </DialogHeader>
            <div className="form-fields">
              <div className="field-group">
                <Label htmlFor="deck-title">Title</Label>
                <Input id="deck-title" name="title" maxLength={100} autoFocus required placeholder="e.g. SQL fundamentals" />
              </div>
              <div className="field-group">
                <Label htmlFor="deck-description">Description <span>Optional</span></Label>
                <Textarea id="deck-description" name="description" maxLength={500} placeholder="What are you learning?" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="primary-button" disabled={saving}>
                {saving ? "Creating…" : "Create deck"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the deck, all of its cards, and its saved study progress. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep deck</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteDeck} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete deck"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
