export type DeckSummary = {
  id: string;
  title: string;
  description: string;
  cardCount: number;
  createdAt: number;
  updatedAt: number;
};

export type DeckRecord = Omit<DeckSummary, "cardCount">;

export type CardRecord = {
  id: string;
  deckId: string;
  front: string;
  back: string;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type StudyCard = CardRecord & {
  lastRating: string | null;
  intervalDays: number | null;
  dueAt: number | null;
  reviewCount: number | null;
};

export type SignedInUser = {
  userId: string;
  displayName: string;
  email: string;
};
