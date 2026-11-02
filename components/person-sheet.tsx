"use client";

import Link from "next/link";
import { useRef } from "react";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import type { DayRhythm } from "@/lib/rhythm";
import { ALIVE_LOOK, type Alive } from "@/lib/status";
import { clockWord, type DayMoment } from "@/lib/window-words";
import { BottomSheet } from "./share-panel";
import { Avatar, Icon } from "./ui/kit";

// The one person sheet. Tapping a person anywhere (the window, the house) opens this: how they
// are, their day at a glance, and two ways to reach them. "See their day" opens the full view
// (their photos, voices and videos, in order). Nothing else opens a person.

export interface WindowPersonData {
  id: string;
  lastActive: string | null;
  state: Alive;
  line: string;
  rhythm: DayRhythm;
  moments?: DayMoment[];
  checkins?: { at: string; label: string }[];
}

/** Their day on one line: today's signs of life against the band they usually keep. */
function RhythmBar({ rhythm }: { rhythm: DayRhythm }) {
  const usual = rhythm.usual;
  return (
    <div>
      <div className="relative h-[32px]" role="img" aria-label={rhythm.ticks.length ? `Active at ${rhythm.ticks.length} times today${usual ? ", against their usual day" : ""}` : "Nothing yet today"}>
        <div className="absolute inset-x-0 top-[12px] h-[8px] rounded-full bg-tint" />
        {usual && <div className="absolute top-[12px] h-[8px] rounded-full bg-accent-soft" style={{ left: `${usual[0] * 100}%`, width: `${Math.max(2, (usual[1] - usual[0]) * 100)}%` }} />}
        {rhythm.ticks.map((t, i) => (
          <span key={i} className="absolute top-[6px] h-[20px] w-[3px] -translate-x-1/2 rounded-full bg-accent" style={{ left: `${t * 100}%` }} />
        ))}
        {rhythm.now !== null && <span className="absolute top-[28px] h-[4px] w-[4px] -translate-x-1/2 rounded-full bg-[#c2343a]" style={{ left: `${rhythm.now * 100}%` }} aria-hidden="true" />}
      </div>
      <div className="mt-0.5 flex justify-between text-caption text-ink-faint" aria-hidden="true">
        {["6 AM", "12 PM", "6 PM", "12 AM"].map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <p className="m-0 mt-1.5 text-caption leading-snug text-ink-soft">{usual ? "Dark marks: today. Soft band: their usual day." : "Dark marks: today. Their usual day appears after a few days."}</p>
    </div>
  );
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
 * A person's day at a glance, and the ways to reach them. `st` is the window's read of them (their
 * rhythm, what they shared, check-ins); a person it has no read for shows `fallback` as their line.
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
  const look = ALIVE_LOOK[s?.state ?? "unknown"];
  return (
    <BottomSheet open={Boolean(person)} onClose={onClose} title={p ? callName(p) : "Their day"}>
      {p && (
        <div data-ui="person-sheet">
          <div className="flex items-center gap-3">
            <span className="relative">
              <Avatar src={memberPhoto(p)} name={callName(p)} size={48} />
              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full ring-2 ring-paper" style={{ background: look.dot }} />
            </span>
            <p className="m-0 min-w-0 flex-1 text-body leading-snug text-ink-soft">{s?.line ?? fallback ?? ""}</p>
          </div>
          {s && (
            <>
              <section data-ui="window-their-day" className="mt-5" aria-label="Their day">
                <h3 className="m-0 mb-1 text-footnote font-medium text-ink-soft">Their day</h3>
                <RhythmBar rhythm={s.rhythm} />
              </section>
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
          {s?.state === "quiet" && (
            <Link href="/nearby" className="mt-1 flex min-h-[44px] items-center justify-center gap-1.5 text-callout font-medium text-ink-soft no-underline">
              <Icon name="gather" size={16} /> Who to call near them
            </Link>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
