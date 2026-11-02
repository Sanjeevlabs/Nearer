"use client";

import { useRef } from "react";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { clockWord, localTimeLine, type DayMoment } from "@/lib/window-words";
import { placeFromTz } from "@/lib/zones";
import { BottomSheet } from "./share-panel";
import { Avatar, Icon } from "./ui/kit";

// The one person sheet. Tapping a person anywhere (the window, the house) opens this: their
// local time, what they chose to share today, their own check-ins, and two ways to reach them. "See their day" opens the full view
// (their photos, voices and videos, in order). Nothing else opens a person.

export interface WindowPersonData {
  id: string;
  /** What they chose to share today, oldest first. */
  moments?: DayMoment[];
  checkins?: { at: string; label: string }[];
}

function SheetList({ title, empty, rows }: { title: string; empty: string; rows: { key: string; at: string; main: string; note?: string }[] }) {
  return (
    <section data-ui="window-section" className="mt-5" aria-label={title}>
      <h3 className="m-0 text-footnote font-medium text-ink-soft">{title}</h3>
      {rows.length === 0 ? (
        <p className="m-0 mt-1.5 text-callout text-ink-soft">{empty}</p>
      ) : (
        <ul className="m-0 mt-1 list-none p-0">
          {rows.map((r) => (
            <li key={r.key} className="flex min-h-[44px] items-baseline gap-3 border-t border-[var(--line)] py-2.5 first:border-0">
              <span className="tnum w-[68px] shrink-0 text-footnote text-ink-soft">{r.at}</span>
              <span className="min-w-0 text-body leading-snug">
                {r.main}
                {r.note && <span className="block text-footnote text-ink-soft">{r.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A person's day, and the ways to reach them. `st` is what the window has for them (what they
 * shared, their check-ins); a person it has nothing for shows `fallback` under their local time.
 * "See their day" opens the full day; both it and the other buttons close this sheet first.
 */
export function PersonSheet({
  person,
  st,
  fallback,
  onTalk,
  onCall,
  onSeeDay,
  onClose,
}: {
  person: Member | null;
  st: WindowPersonData | undefined;
  fallback?: string;
  onTalk: () => void;
  onCall: () => void;
  onSeeDay: () => void;
  onClose: () => void;
}) {
  // Keep the last person while the sheet slides away.
  const last = useRef<{ person: Member; st: WindowPersonData | undefined } | null>(null);
  if (person) last.current = { person, st };
  const shown = person ? { person, st } : last.current;
  const p = shown?.person;
  const s = shown?.st;
  return (
    <BottomSheet open={Boolean(person)} onClose={onClose} title={p ? callName(p) : "Their day"}>
      {p && (
        <div data-ui="person-sheet">
          <div className="flex items-center gap-3">
            <Avatar src={memberPhoto(p)} name={callName(p)} size={48} />
            <p className="m-0 min-w-0 flex-1 text-body leading-snug text-ink-soft" suppressHydrationWarning>
              {localTimeLine(p.tz, p.city || placeFromTz(p.tz))}
              {!s && fallback ? <span className="block text-footnote">{fallback}</span> : null}
            </p>
          </div>
          {s && (
            <>
              <SheetList title="Shared today" empty="Nothing shared yet today." rows={(s.moments ?? []).map((mo, i) => ({ key: `${mo.at}-${i}`, at: clockWord(mo.at, p.tz), main: mo.label, note: mo.note }))} />
              <SheetList title="Check-ins" empty="No check-ins today." rows={(s.checkins ?? []).map((c, i) => ({ key: `${c.at}-${i}`, at: clockWord(c.at, p.tz), main: c.label }))} />
            </>
          )}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button type="button" onClick={onTalk} className="press flex h-12 items-center justify-center gap-2 rounded-full bg-tint text-body font-semibold text-ink">
              <Icon name="mic" size={19} /> Voice note
            </button>
            <button type="button" onClick={onCall} className="press flex h-12 items-center justify-center gap-2 rounded-full bg-accent text-body font-semibold text-accent-ink">
              <Icon name="video" size={19} /> Call
            </button>
          </div>
          <button type="button" data-ui="see-their-day" onClick={onSeeDay} className="press mt-2 flex h-12 w-full items-center justify-center gap-1.5 rounded-full bg-accent-soft text-body font-semibold text-accent-soft-ink">
            See their day <Icon name="chevron" size={16} />
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
