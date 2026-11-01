"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { deepEqual, draftReducer, initDraft, isDirty, SAVED_FLASH_MS, type DraftStatus, type Eq, type SaveResult } from "@/lib/settings-draft";
import { clearPending, getPending } from "@/lib/settings-pending";

export interface Draft<T> {
  draft: T;
  saved: T;
  dirty: boolean;
  status: DraftStatus;
  error: string | null;
  /** Change the draft. Never touches the server. */
  set: (patch: Partial<T> | ((d: T) => T)) => void;
  /** Run `fn` with the draft; the section's one Save. */
  save: (fn: (draft: T, saved: T) => Promise<SaveResult<T>>) => Promise<boolean>;
  discard: () => void;
}

/**
 * A section's edits, held locally until Save. `initial` is what the server has;
 * when it changes (a reload) and nothing is being edited, the draft follows.
 * With `id`, an unsaved draft is restored after a trip to another page.
 */
export function useDraft<T>(initial: T, opts: { id?: string; eq?: Eq<T> } = {}): Draft<T> {
  const eq = opts.eq ?? deepEqual;
  const id = opts.id;
  const [state, dispatch] = useReducer(draftReducer<T>, undefined, () => {
    const kept = id ? getPending(id) : undefined;
    return initDraft(initial, kept ? (kept.draft as T) : initial);
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  // Follow the server when it changes under a clean draft.
  const key = useMemo(() => JSON.stringify(initial), [initial]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    dispatch({ type: "rebase", value: initial, eq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // "Saved" shows for two seconds.
  useEffect(() => {
    if (state.status !== "saved") return;
    const t = window.setTimeout(() => dispatch({ type: "settle" }), SAVED_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [state.status]);

  const set = useCallback((patch: Partial<T> | ((d: T) => T)) => dispatch({ type: "edit", patch }), []);
  const discard = useCallback(() => {
    dispatch({ type: "discard" });
    if (id) clearPending(id);
  }, [id]);
  const save = useCallback(
    async (fn: (draft: T, saved: T) => Promise<SaveResult<T>>) => {
      const cur = stateRef.current;
      if (cur.status === "saving" || isDirty(cur, eq) === false) return true;
      dispatch({ type: "saving" });
      const sent = cur.draft;
      let result: SaveResult<T>;
      try {
        result = await fn(sent, cur.saved);
      } catch {
        result = { ok: false, error: "Couldn't save that. Try again." };
      }
      if (result.ok) dispatch({ type: "saved", sent, saved: result.saved, draft: result.draft, eq });
      else dispatch({ type: "failed", error: result.error, saved: result.saved, draft: result.draft });
      return result.ok;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { draft: state.draft, saved: state.saved, dirty: isDirty(state, eq), status: state.status, error: state.error, set, save, discard };
}
