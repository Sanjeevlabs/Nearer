"use client";

import { useMemo } from "react";
import { PhotoWishButton } from "@/components/occasion-wish";
import { useShell } from "@/components/shell";
import { Avatar, Icon } from "@/components/ui/kit";
import { addDays, daysBetween, localTodayIso, occasionsInRange, visibleHolidays, whenLabel, type CalHoliday, type CalOccasion } from "@/lib/occasion-calendar";
import { callName, memberPhoto } from "@/lib/people";
import type { Member, RitualRun, Wish } from "@/lib/schemas";
import { useJson } from "@/lib/use-json";

// Muse's ask, a week out (Celebrations → Coming up): every grown-up records a
// wish, voice or photo, and it plays with everyone's on the day.

interface Data {
  holidays: CalHoliday[];
  traditions: string[];
  kept: string[];
  skipped: string[];
  members: Member[];
  runs: RitualRun[];
  wishes: Wish[];
}

/** How many days ahead the family is asked for wishes. */
const ASK_DAYS = 7;

export function WishAhead({ viewer }: { viewer: Member }) {
  const { openAdd, refreshKey } = useShell();
  const { data, reload } = useJson<Data>(viewer.role === "child" ? null : `/api/rituals?k=${refreshKey}`);
  const today = localTodayIso();
  const ask = useMemo(() => {
    if (!data) return null;
    const shown = visibleHolidays(data.holidays, { traditions: data.traditions, kept: data.kept, skipped: data.skipped });
    const runOf = (o: CalOccasion) => data.runs.find((r) => r.ritualSlug === o.slug && r.occasionDate === o.date) ?? null;
    const wishedBy = (run: RitualRun) => data.wishes.filter((w) => w.ritualRunId === run.id);
    for (const o of occasionsInRange(data.members, shown, today, addDays(today, ASK_DAYS))) {
      const run = runOf(o);
      if (o.kind === "national" || o.date === today || o.memberId === viewer.id || !run) continue;
      if (wishedBy(run).some((w) => w.memberId === viewer.id)) continue;
      return { o, run, person: o.memberId ? (data.members.find((m) => m.id === o.memberId) ?? null) : null };
    }
    return null;
  }, [data, today, viewer.id]);
  // A child is never asked (no fetch above); the guard also covers the first paint before the session resolves, when a grown-up fallback viewer's cached data would flash the row.
  if (!ask || viewer.role === "child") return null;
  const { o, run, person } = ask;
  const title = person ? `${callName(person)}'s birthday` : o.title;
  const word = viewer.role === "elder" ? "blessing" : "wish";
  return (
    <section aria-label="Wish ahead" className="mb-4 flex items-center gap-3 rounded-card bg-card px-4 py-3 shadow-card">
      {person ? <Avatar src={memberPhoto(person)} name={callName(person)} size={44} /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-well text-ink"><Icon name="flower" size={20} /></span>}
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold leading-snug">Record a {word} for {title}</span>
        <span className="block text-footnote text-ink-soft">{whenLabel(daysBetween(today, o.date), o.date)} · it plays with everyone&rsquo;s on the day</span>
      </span>
      <button type="button" onClick={() => openAdd("voice", { runId: run.id, kind: viewer.role === "elder" ? "blessing" : "wish" }, o.memberId)} aria-label={`Record a voice ${word} for ${title}`} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
        <Icon name="mic" size={18} />
      </button>
      <PhotoWishButton run={run} viewer={viewer} forName={person ? callName(person) : o.title} onDone={() => void reload()} className="h-11 w-11 bg-well text-ink" />
    </section>
  );
}
