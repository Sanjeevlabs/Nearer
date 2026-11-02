// "How to listen" (an experiment): when sending a voice note to particular people, the sender
// may say how they would like it heard. A wish, not a diagnosis or a demand: never required,
// never sent as a nudge, and shown only to the people it was sent to ("Arjun: just listen").
import type { LISTEN_WAYS } from "./kind-values";
import type { CardListen } from "./kinds";

export type ListenWay = (typeof LISTEN_WAYS)[number];

export const LISTEN_WORDS: Record<ListenWay, string> = {
  "just-listen": "just listen",
  "help-me-think": "help me think",
  "keep-me-company": "keep me company",
};

/** The label for this viewer, or null: only an addressee (not the sender, not anyone else) sees it. */
export function listenFor(doc: Pick<CardListen, "listen" | "to" | "authorId"> | undefined, viewerId: string): ListenWay | null {
  if (!doc || doc.authorId === viewerId || !doc.to.includes(viewerId)) return null;
  return doc.listen;
}

/** Decorate cards with the label, for this viewer only. */
export function withListen<C extends { id: string }>(cards: C[], docs: CardListen[], viewerId: string): (C & { listen?: ListenWay })[] {
  if (docs.length === 0) return cards;
  const by = new Map(docs.map((d) => [d.cardId, d]));
  return cards.map((c) => {
    const way = listenFor(by.get(c.id), viewerId);
    return way ? { ...c, listen: way } : c;
  });
}
