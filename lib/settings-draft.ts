// Settings never auto-save. Each section holds its edits as a draft and writes
// them only when the person taps Save. This file is the pure part (a reducer
// and a few helpers); components/settings/use-draft.ts wires it to React.

export type DraftStatus = "idle" | "saving" | "saved" | "error";

export type Eq<T> = (a: T, b: T) => boolean;

export interface DraftState<T> {
  /** What the server has (or the last thing we saved). */
  saved: T;
  /** What the person is editing. */
  draft: T;
  status: DraftStatus;
  error: string | null;
}

export type DraftAction<T> =
  | { type: "edit"; patch: Partial<T> | ((d: T) => T) }
  | { type: "discard" }
  | { type: "saving" }
  /** `sent` is the draft that was written; `saved`/`draft` override the new baselines (partial progress). */
  | { type: "saved"; sent: T; saved?: T; draft?: T; eq?: Eq<T> }
  | { type: "failed"; error: string; saved?: T; draft?: T }
  | { type: "settle" }
  /** The server value changed (a reload): adopt it unless the person is mid-edit. */
  | { type: "rebase"; value: T; eq?: Eq<T> };

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function initDraft<T>(initial: T, draft: T = initial): DraftState<T> {
  return { saved: initial, draft, status: "idle", error: null };
}

export function isDirty<T>(s: DraftState<T>, eq: Eq<T> = deepEqual): boolean {
  return !eq(s.draft, s.saved);
}

export function draftReducer<T>(s: DraftState<T>, a: DraftAction<T>): DraftState<T> {
  switch (a.type) {
    case "edit": {
      const draft = typeof a.patch === "function" ? a.patch(s.draft) : { ...s.draft, ...a.patch };
      // Editing clears "Saved" and any old error; a save in flight keeps saving.
      return { ...s, draft, status: s.status === "saving" ? "saving" : "idle", error: s.status === "saving" ? s.error : null };
    }
    case "discard":
      return s.status === "saving" ? s : { ...s, draft: s.saved, status: "idle", error: null };
    case "saving":
      return { ...s, status: "saving", error: null };
    case "saved": {
      const eq = a.eq ?? deepEqual;
      const saved = a.saved ?? a.sent;
      // Edits made while the request was in flight stay as the draft.
      const draft = a.draft ?? (eq(s.draft, a.sent) ? saved : s.draft);
      return { saved, draft, status: "saved", error: null };
    }
    case "failed":
      return { saved: a.saved ?? s.saved, draft: a.draft ?? s.draft, status: "error", error: a.error };
    case "settle":
      return s.status === "saved" ? { ...s, status: "idle" } : s;
    case "rebase": {
      if (s.status === "saving") return s;
      const eq = a.eq ?? deepEqual;
      const clean = eq(s.draft, s.saved);
      return { ...s, saved: a.value, draft: clean ? a.value : s.draft };
    }
  }
}

/** What a section's save function reports. Partial progress sets new baselines. */
export type SaveResult<T> = { ok: true; saved?: T; draft?: T } | { ok: false; error: string; saved?: T; draft?: T };

export const SAVED_FLASH_MS = 2000;
