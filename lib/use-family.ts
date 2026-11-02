"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Card } from "./schemas";

// One shared, cached fetch of the family's cards. Every screen reads from the
// same snapshot, so navigating between rooms never flashes empty or refetches
// needlessly. refreshKey (from the shell) forces a revalidation after uploads.

let cache: Card[] | null = null;
let inflight: Promise<Card[]> | null = null;
let loadedAt = 0;
let loadedKey = -1;
const listeners = new Set<() => void>();

// The server already joins the demo shelf (demo family only) and holds back
// today's sealed answers, so the client takes the list as given.
function merge(server: Card[]): Card[] {
  return [...server].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

async function load(): Promise<Card[]> {
  if (inflight) return inflight;
  inflight = fetch("/api/cards", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ cards: Card[]; familyId?: string }>) : { cards: [] as Card[], familyId: undefined }))
    .then((d) => merge(d.cards))
    .catch(() => [] as Card[])
    .then((cards) => {
      cache = cards;
      inflight = null;
      loadedAt = Date.now();
      listeners.forEach((l) => l());
      return cards;
    });
  return inflight;
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
    void load();
  }, [refreshKey, enabled]);
  return { cards };
}

/** Forget the cached snapshot (sign-out, switching family). */
export function resetFamilyCards(): void {
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
  });
  window.addEventListener("aangan:changed", () => {
    loadedAt = 0;
    if (listeners.size > 0) void load();
  });
}
