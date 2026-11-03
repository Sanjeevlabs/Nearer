// Who may see a card. A card spoken or sent to particular people (`addressedTo`) belongs to its
// author and those people only; a card with no addressee is the whole family's. Every server
// path that hands a card (or its media, plays, reactions or words) to someone filters through
// here first: lists, single cards, signed media, search, export, the window, the courtyard,
// stories and the book. tests/private-cards.test.ts holds every reader to it.
//
// `forMemberId` on a card is not an audience: it pins a drawing to a kid's fridge, which the
// whole family looks at, so it stays family-wide unless it is also addressed.
//
// Pure and client-safe (the "Just for Maa" label is worked out here too).
import { addressees } from "./households";
import type { Card, Member } from "./schemas";

type Gate = Pick<Card, "addressedTo"> & { authorId?: string | null };

/**
 * Who is looking: a member id, or FAMILY_WIDE for something everyone in the family will see
 * (a weekly letter, a family-wide nudge, a public share), which may carry only family-wide cards.
 */
export const FAMILY_WIDE = null;
export type CardViewer = string | null;

/** The people a card is for, or null when it is the whole family's. */
export function audienceOf(card: Gate): string[] | null {
  const to = addressees(card);
  return to.length ? to : null;
}

export function isPrivateCard(card: Gate): boolean {
  return audienceOf(card) !== null;
}

/** True when this viewer may see the card at all (and so its media, plays, reactions and words). */
export function canSeeCard(card: Gate, viewer: CardViewer): boolean {
  const to = audienceOf(card);
  if (!to) return true;
  if (!viewer) return false;
  return viewer === card.authorId || to.includes(viewer);
}

/** The cards this viewer may see, in the same order. */
export function seenBy<C extends Gate>(cards: readonly C[], viewer: CardViewer): C[] {
  return cards.filter((c) => canSeeCard(c, viewer));
}

/** Ids of the cards this viewer may not see: for filtering things that point at cards (plays, reactions, docs). */
export function hiddenCardIds(cards: readonly (Gate & { id: string })[], viewer: CardViewer): Set<string> {
  return new Set(cards.filter((c) => !canSeeCard(c, viewer)).map((c) => c.id));
}

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 3) return `${names.length} people`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The small label on a private card, for the people who can see it: "Just for you" (or
 * "Just for you and Papa") for someone it was sent to, "Just for Maa" for its author.
 * Null on a family-wide card, or for a viewer who should not be seeing it.
 */
export function privateLabel(card: Gate, viewerId: string | null | undefined, members: readonly Pick<Member, "id" | "displayName" | "firstName">[]): string | null {
  const to = audienceOf(card);
  if (!to || !viewerId || !canSeeCard(card, viewerId)) return null;
  const name = (id: string) => {
    const m = members.find((x) => x.id === id);
    return (m?.displayName || m?.firstName || "").trim() || "someone";
  };
  const others = to.filter((id) => id !== viewerId && id !== card.authorId);
  if (to.includes(viewerId)) return others.length ? `Just for you and ${nameList(others.map(name))}` : "Just for you";
  return `Just for ${nameList(to.filter((id) => id !== viewerId).map(name)) || "you"}`;
}
