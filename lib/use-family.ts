"use client";

import { useEffect, useSyncExternalStore } from "react";
import { fetchFirst } from "./early";
import type { Card } from "./schemas";

// One shared, cached fetch of the family's cards. Every screen reads from the
// same snapshot, so navigating between rooms never flashes empty or refetches
// needlessly. refreshKey (from the shell) forces a revalidation after uploads.

let cache: Card[] | null = null;
let inflight: Promise<Card[]> | null = null;
let loadedAt = 0;
let loadedKey = -1;
/** The refresh key the mounted readers last asked with (a load the switch starts counts as theirs). */
let wantedKey = 0;
/** Moves on with every reset: an answer read for the last person or family is never kept. */
let gen = 0;
const listeners = new Set<() => void>();

// The server already joins the demo shelf (demo family only) and holds back
// today's sealed answers, so the client takes the list as given.
function merge(server: Card[]): Card[] {
  return [...server].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

async function load(): Promise<Card[]> {
  if (inflight) return inflight;
  const asked = gen;
  // The first screen's request may already be on its way (lib/early.ts).
  const mine: Promise<Card[]> = fetchFirst("/api/cards")
    .then((r) => (r.ok ? (r.json() as Promise<{ cards: Card[]; familyId?: string }>) : { cards: [] as Card[], familyId: undefined }))
    .then((d) => merge(d.cards))
    .catch(() => [] as Card[])
    .then((cards) => {
      if (asked !== gen) return cards;
      cache = cards;
      inflight = null;
      loadedAt = Date.now();
      listeners.forEach((l) => l());
      return cards;
    });
  inflight = mine;
  return mine;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * The cards, from the shared snapshot. While hydrating, React uses the server
 * snapshot (null, as the server rendered it) even if the fetch already landed,
 * so a page that hydrates late never mismatches (React error #418).
 */
export function useFamilyCards(refreshKey = 0, enabled = true): { cards: Card[] | null } {
  const cards = useSyncExternalStore(subscribe, () => cache, () => null);
  useEffect(() => {
    // Not needed yet (the dock while it is hidden): read nothing.
    if (!enabled) return;
    // Two mounts in the same moment (shell + room) share one fetch; a later mount revalidates.
    if (cache && refreshKey === loadedKey && Date.now() - loadedAt < 2000) return;
    loadedKey = refreshKey;
    wantedKey = refreshKey;
    void load();
  }, [refreshKey, enabled]);
  return { cards };
}

/** Forget the cached snapshot (sign-out, switching family). */
export function resetFamilyCards(): void {
  gen++;
  cache = null;
  inflight = null;
  loadedAt = 0;
  loadedKey = -1;
}

// The person or family changed: the old snapshot must never paint for the next one.
// Something was written: refetch the cards a moment later (coalesced) if anyone is showing them.
if (typeof window !== "undefined") {
  window.addEventListener("aangan:auth", () => {
    resetFamilyCards();
    listeners.forEach((l) => l());
    // Someone is showing cards: read the new person's or side's now (a reader that remounts a moment later shares it).
    if (listeners.size > 0) {
      loadedKey = wantedKey;
      void load();
    }
  });
  window.addEventListener("aangan:changed", () => {
    loadedAt = 0;
    if (listeners.size > 0) void load();
  });
}
