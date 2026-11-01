"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { SaveResult } from "@/lib/settings-draft";
import { clearPending, pendingSnapshot, sectionActions, setPending, subscribePending } from "@/lib/settings-pending";
import type { Draft } from "./use-draft";

/** A titled block of Settings with no Save: its controls are actions, not preferences. */
export function Group({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section aria-label={title} id={id} className="mt-9 scroll-mt-6">
      <h2 className="m-0 mb-3 text-[20px]">{title}</h2>
      {children}
    </section>
  );
}

/**
 * A titled block of preferences with its own Save. Nothing in it writes until
 * Save: the Save button is off until something changed, shows "Saving…" and
 * then "Saved" for two seconds, and on failure shows the error with Retry.
 * "Discard" puts back what was saved.
 */
export function SettingsSection<T>({
  id,
  title,
  tab,
  form,
  onSave,
  hideTitle,
  hideSave,
  children,
}: {
  id: string;
  title: string;
  tab: string;
  form: Draft<T>;
  onSave: (draft: T, saved: T) => Promise<SaveResult<T>>;
  hideTitle?: boolean;
  /** A section the viewer cannot change (no controls): no Save row. */
  hideSave?: boolean;
  children: ReactNode;
}) {
  const { dirty, status, error, draft, save, discard } = form;

  // Tell the "Unsaved changes" banner (and a later visit to this page).
  useEffect(() => {
    if (dirty) setPending(id, { title, tab, draft });
    else clearPending(id);
  }, [dirty, id, title, tab, draft]);
  useEffect(() => {
    sectionActions.set(id, { save: () => void save(onSave), discard });
    return () => void sectionActions.delete(id);
  });

  const saving = status === "saving";
  const justSaved = status === "saved" && !dirty;
  return (
    <section aria-label={title} id={id} className="mt-9 scroll-mt-6">
      {!hideTitle && <h2 className="m-0 mb-3 text-[20px]">{title}</h2>}
      {children}
      {!hideSave && (
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save(onSave)}
          aria-label={`Save ${title}`}
          className="press h-11 min-w-[88px] rounded-full bg-ink px-6 text-[15px] font-semibold text-white disabled:opacity-35"
        >
          {saving ? "Saving…" : justSaved ? "Saved" : "Save"}
        </button>
        {dirty && !saving && (
          <button type="button" onClick={discard} aria-label={`Discard changes to ${title}`} className="press h-11 rounded-full px-3 text-[14px] font-medium text-ink-soft underline underline-offset-2">
            Discard
          </button>
        )}
        <span role="status" aria-live="polite" className="text-[13px] text-ink-soft">
          {justSaved ? "Saved" : ""}
        </span>
      </div>
      )}
      {!hideSave && status === "error" && error && (
        <p role="alert" className="m-0 mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-[#c2343a]">
          {error}
          <button type="button" onClick={() => void save(onSave)} className="press h-11 rounded-full px-3 text-[13px] font-semibold text-ink underline underline-offset-2">
            Retry
          </button>
        </p>
      )}
    </section>
  );
}

/** Sections with unsaved edits that are not on screen: Save or Discard them from here. */
export function UnsavedBanner({ tab }: { tab: string }) {
  const all = useSyncExternalStore(subscribePending, pendingSnapshot, () => []);
  const away = all.filter(([, e]) => e.tab !== tab);
  if (away.length === 0) return null;
  return (
    <div className="mt-3 space-y-2" role="status" aria-live="polite">
      {away.map(([id, e]) => (
        <div key={id} className="flex flex-wrap items-center gap-x-3 rounded-[18px] bg-[#fff4d6] px-4 py-1.5">
          <span className="min-w-0 flex-1 py-2 text-[14px] font-medium">Unsaved changes in {e.title}</span>
          <button type="button" onClick={() => sectionActions.get(id)?.save()} className="press h-11 rounded-full px-3 text-[14px] font-semibold">
            Save
          </button>
          <button type="button" onClick={() => sectionActions.get(id)?.discard()} className="press h-11 rounded-full px-3 text-[14px] font-medium text-ink-soft underline underline-offset-2">
            Discard
          </button>
        </div>
      ))}
    </div>
  );
}
