// Unsaved drafts survive a tab switch (the panels stay mounted) and a trip to
// another page and back (this module lives as long as the app does). They are
// never written anywhere: a reload, or signing out, drops them.

export interface PendingEntry {
  title: string;
  tab: string;
  draft: unknown;
}

const pending = new Map<string, PendingEntry>();
const listeners = new Set<() => void>();
let snapshot: [string, PendingEntry][] = [];

function emit(): void {
  snapshot = [...pending.entries()];
  for (const l of listeners) l();
}

export function setPending(id: string, entry: PendingEntry): void {
  const prev = pending.get(id);
  if (prev && prev.draft === entry.draft && prev.title === entry.title && prev.tab === entry.tab) return;
  pending.set(id, entry);
  emit();
}

export function clearPending(id: string): void {
  if (pending.delete(id)) emit();
}

export function getPending(id: string): PendingEntry | undefined {
  return pending.get(id);
}

/** Stable between changes (for useSyncExternalStore). */
export function pendingSnapshot(): [string, PendingEntry][] {
  return snapshot;
}

export function subscribePending(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Tabs that hold an unsaved draft (so the page can open them again). */
export function getPendingTabs(): string[] {
  return Array.from(new Set([...pending.values()].map((e) => e.tab)));
}

/** Section id -> what the banner may call. Set by each mounted section. */
export interface SectionActions {
  save: () => void;
  discard: () => void;
}
export const sectionActions = new Map<string, SectionActions>();

export function clearAllPending(): void {
  pending.clear();
  emit();
}
if (typeof window !== "undefined") window.addEventListener("aangan:auth", clearAllPending);
