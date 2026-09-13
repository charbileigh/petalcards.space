"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Download,
  FileJson,
  FileSpreadsheet,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CardRecord, DeckRecord } from "@/lib/types";

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

export function DeckWorkspace({
  initialDeck,
  initialCards,
}: {
  initialDeck: DeckRecord;
  initialCards: CardRecord[];
}) {
  const [deck, setDeck] = useState(initialDeck);
  const [cards, setCards] = useState(initialCards);
  const [query, setQuery] = useState("");
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [deckDialogOpen, setDeckDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CardRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CardRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const visibleCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter((card) =>
      `${card.front} ${card.back}`.toLowerCase().includes(needle),
    );
  }, [cards, query]);

  const addCards = useCallback(
    async (drafts: Array<{ front: string; back: string }>) => {
      const response = await fetch(`/api/decks/${deck.id}/cards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cards: drafts }),
      });
      const body = await responseJson<{ cards: CardRecord[] }>(response);
      setCards((current) => [...current, ...body.cards]);
      return body.cards;
    },
    [deck.id],
  );

  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await modelContext.registerTool(
        {
          name: "add_flashcards_to_deck",
          title: "Add flashcards to this deck",
          description: "Add one or more front-and-back flashcards to the Petalcards deck currently open.",
          inputSchema: {
            type: "object",
            properties: {
              cards: {
                type: "array",
                minItems: 1,
                maxItems: 50,
                items: {
                  type: "object",
                  properties: {
                    front: { type: "string", minLength: 1, maxLength: 2000 },
                    back: { type: "string", minLength: 1, maxLength: 2000 },
                  },
                  required: ["front", "back"],
                  additionalProperties: false,
                },
              },
            },
            required: ["cards"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input) => {
            const value = input as { cards?: Array<{ front?: unknown; back?: unknown }> };
            if (!Array.isArray(value.cards) || value.cards.length < 1 || value.cards.length > 50) {
              throw new Error("Provide between 1 and 50 cards.");
            }
            const drafts = value.cards.map((card) => {
              if (typeof card.front !== "string" || typeof card.back !== "string" || !card.front.trim() || !card.back.trim()) {
                throw new Error("Every card needs a front and a back.");
              }
              return { front: card.front, back: card.back };
            });
            const created = await addCards(drafts);
            return { deckId: deck.id, added: created.length, cardIds: created.map((card) => card.id) };
          },
        },
        { signal: lifecycle.signal },
      );
    };
    void register().catch((error) => console.error("WebMCP registration failed", error));
    return () => lifecycle.abort();
  }, [addCards, deck.id]);

  function openNewCard() {
    setEditingCard(null);
    setCardDialogOpen(true);
  }

  function openEditCard(card: CardRecord) {
    setEditingCard(card);
    setCardDialogOpen(true);
  }

  async function saveDeck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const response = await fetch(`/api/decks/${deck.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: String(form.get("title") || ""),
          description: String(form.get("description") || ""),
        }),
      });
      const body = await responseJson<{ deck: DeckRecord }>(response);
      setDeck(body.deck);
      setDeckDialogOpen(false);
      toast.success("Deck details updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The deck could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const draft = {
      front: String(form.get("front") || ""),
      back: String(form.get("back") || ""),
    };
    setSaving(true);
    try {
      if (editingCard) {
        const response = await fetch(`/api/cards/${editingCard.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });
        const body = await responseJson<{ card: CardRecord }>(response);
        setCards((current) => current.map((card) => (card.id === body.card.id ? body.card : card)));
        toast.success("Card updated");
      } else {
        await addCards([draft]);
        toast.success("Card added");
      }
      setCardDialogOpen(false);
      setEditingCard(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The card could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCard() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/cards/${deleteTarget.id}`, { method: "DELETE" });
      await responseJson<{ deleted: true }>(response);
      setCards((current) => current.filter((card) => card.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("Card deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The card could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="page-container deck-workspace">
      <Link href="/" className="back-link"><ArrowLeft /> My decks</Link>

      <section className="deck-heading">
        <div>
          <div className="heading-title-row">
            <h1>{deck.title}</h1>
            <Button variant="ghost" size="icon-sm" onClick={() => setDeckDialogOpen(true)} aria-label="Edit deck details">
              <Pencil />
            </Button>
          </div>
          <p>{deck.description || "Add a description to keep the purpose of this deck clear."}</p>
        </div>
        <div className="deck-heading-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline"><Download /> Download</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={`/api/decks/${deck.id}/export?format=csv`}><FileSpreadsheet /> CSV file</a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/decks/${deck.id}/export?format=json`}><FileJson /> JSON file</a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {cards.length ? (
            <Button asChild variant="secondary">
              <Link href={`/study/${deck.id}`}><BookOpen /> Study</Link>
            </Button>
          ) : (
            <Button variant="secondary" disabled><BookOpen /> Study</Button>
          )}
          <Button className="primary-button" onClick={openNewCard}><Plus /> New card</Button>
        </div>
      </section>

      <section className="cards-section" aria-labelledby="cards-heading">
        <div className="library-toolbar card-toolbar">
          <div>
            <h2 id="cards-heading">Cards</h2>
            <span>{cards.length} {cards.length === 1 ? "card" : "cards"}</span>
          </div>
          {cards.length > 4 && (
            <label className="search-box">
              <Search aria-hidden="true" />
              <span className="sr-only">Search cards</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search cards" />
            </label>
          )}
        </div>

        {visibleCards.length ? (
          <div className="card-list">
            {visibleCards.map((card, index) => (
              <article className="card-row" key={card.id}>
                <span className="card-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="card-side">
                  <small>Front</small>
                  <p>{card.front}</p>
                </div>
                <div className="card-divider" aria-hidden="true" />
                <div className="card-side">
                  <small>Back</small>
                  <p>{card.back}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for card ${index + 1}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEditCard(card)}><Pencil /> Edit card</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(card)}><Trash2 /> Delete card</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </article>
            ))}
          </div>
        ) : query ? (
          <div className="empty-state compact-empty"><Search /><h3>No matching cards</h3><p>Try another word.</p></div>
        ) : (
          <button className="empty-state empty-state-button" onClick={openNewCard}>
            <span className="empty-stack" aria-hidden="true"><Plus /></span>
            <h3>Add your first card</h3>
            <p>Write a prompt on the front and the answer on the back.</p>
            <span className="empty-action"><Plus /> New card</span>
          </button>
        )}
      </section>

      <Dialog open={deckDialogOpen} onOpenChange={setDeckDialogOpen}>
        <DialogContent className="form-dialog">
          <form onSubmit={saveDeck}>
            <DialogHeader>
              <DialogTitle>Edit deck</DialogTitle>
              <DialogDescription>Update the name or add a little context.</DialogDescription>
            </DialogHeader>
            <div className="form-fields">
              <div className="field-group">
                <Label htmlFor="edit-deck-title">Title</Label>
                <Input id="edit-deck-title" name="title" defaultValue={deck.title} maxLength={100} required />
              </div>
              <div className="field-group">
                <Label htmlFor="edit-deck-description">Description <span>Optional</span></Label>
                <Textarea id="edit-deck-description" name="description" defaultValue={deck.description} maxLength={500} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDeckDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cardDialogOpen} onOpenChange={(open) => { setCardDialogOpen(open); if (!open) setEditingCard(null); }}>
        <DialogContent className="form-dialog card-form-dialog">
          <form onSubmit={saveCard} key={editingCard?.id ?? "new-card"}>
            <DialogHeader>
              <DialogTitle>{editingCard ? "Edit card" : "Add a card"}</DialogTitle>
              <DialogDescription>Keep each card focused on one thing you want to remember.</DialogDescription>
            </DialogHeader>
            <div className="form-fields">
              <div className="field-group">
                <Label htmlFor="card-front">Front</Label>
                <Textarea id="card-front" name="front" defaultValue={editingCard?.front} maxLength={2000} required autoFocus placeholder="Question, term, or prompt" />
              </div>
              <div className="field-group">
                <Label htmlFor="card-back">Back</Label>
                <Textarea id="card-back" name="back" defaultValue={editingCard?.back} maxLength={2000} required placeholder="Answer or explanation" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCardDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : editingCard ? "Save card" : "Add card"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this card?</AlertDialogTitle>
            <AlertDialogDescription>The card and its study progress will be removed permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep card</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteCard} disabled={deleting}>{deleting ? "Deleting…" : "Delete card"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
