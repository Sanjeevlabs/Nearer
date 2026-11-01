"use client";

import { AnimatePresence, m } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { daysInWords, pruneStepTicks, stepTicksKey, type FestivalWeek, type FestivalWeekPayload } from "@/lib/festival-week";
import { lampGlowCss } from "@/lib/lamp";
import { callName, cardCover } from "@/lib/people";
import { useFamilyCards } from "@/lib/use-family";
import { useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { useShell } from "./shell";
import { Icon, Photo } from "./ui/kit";
import { useViewer } from "./viewer";

// Festival Week (courtyard header, Occasions, Aangan suggests): the days
// before a festival the family keeps. Title, steps, colour and greeting are
// the ritual's own JSON (rituals/*.json); this file names no festival.

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The viewer's festival week, or null (no kept festival in the next seven days, loading, or failed). */
export function useFestivalWeek(): { week: FestivalWeekPayload | null; loading: boolean; failed: boolean } {
  const { refreshKey } = useShell();
  // No cache-buster: inside the courtyard this is one slice of GET /api/courtyard, refreshed with it.
  const { data, failed, reload } = useJson<{ week: FestivalWeekPayload | null }>("/api/festival-week");
  useEffect(() => {
    if (refreshKey) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  return { week: data?.week ?? null, loading: data === null && !failed, failed };
}

/** The wish-ahead recorder's contribution (the same one components/wish-ahead.tsx opens). */
export function wishContribution(role: "elder" | "adult" | "child", runId: string) {
  return { runId, kind: role === "elder" ? ("blessing" as const) : ("wish" as const) };
}

/* ------------------------------------------------------------- the checklist */
function useTicks(key: string): [Set<number>, (i: number) => void] {
  const [done, setDone] = useState<Set<number>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      setDone(new Set(raw ? (JSON.parse(raw) as number[]) : []));
    } catch {
      setDone(new Set());
    }
  }, [key]);
  const toggle = useCallback(
    (i: number) =>
      setDone((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        try {
          localStorage.setItem(key, JSON.stringify([...next]));
        } catch {
          // private mode: the ticks just don't stick
        }
        return next;
      }),
    [key],
  );
  return [done, toggle];
}

/**
 * The steps of the ritual as a teachable checklist: tick what you've covered,
 * and tap the mic beside a step to record how your family does it (a story the
 * children can hear later).
 */
export function FestivalStepsSheet({ week, open, onClose }: { week: Pick<FestivalWeek, "slug" | "title" | "date" | "stepsForLead" | "accent" | "greeting"> | null; open: boolean; onClose: () => void }) {
  const { openAdd } = useShell();
  const { viewer } = useViewer();
  const [done, toggle] = useTicks(week ? stepTicksKey(viewer.familyId, week.slug, week.date) : "aangan:festival-steps:none");
  useEffect(() => {
    // Last year's ticks and the old un-keyed ones go once this year's sheet is used.
    if (!week) return;
    try {
      pruneStepTicks(localStorage, week.date.slice(0, 4));
    } catch {
      /* private mode */
    }
  }, [week]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && week && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-labelledby="festival-steps-title" data-ui="festival-steps-sheet">
          <m.button type="button" aria-label="Close" className="absolute inset-0 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <m.div
            className="relative w-full max-w-[480px] overflow-y-auto rounded-t-[32px] bg-white px-5 pt-3 shadow-frost"
            style={{ maxHeight: "86vh", paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-black/15" aria-hidden="true" />
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 id="festival-steps-title" className="m-0 text-[22px] leading-tight">
                  How we do {week.title}
                </h2>
                <p className="m-0 mt-1.5 text-[14px] text-ink-soft">Tap a mic to say how your family does each step. The children will hear you.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-well text-ink">
                <Icon name="close" size={18} />
              </button>
            </div>
            <ol className="m-0 mt-4 list-none space-y-2 p-0">
              {week.stepsForLead.map((step, i) => {
                const on = done.has(i);
                return (
                  <li key={i} className="flex items-center gap-2 rounded-[20px] bg-card p-2 pl-3 shadow-card">
                    <button type="button" role="checkbox" aria-checked={on} aria-label={`${on ? "Untick" : "Tick"}: ${step}`} onClick={() => toggle(i)} className="press flex min-h-[44px] min-w-0 flex-1 items-center gap-3 text-left">
                      <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full", on ? "bg-ink text-white" : "ring-1 ring-black/25")} aria-hidden="true">
                        {on && <Icon name="check" size={13} />}
                      </span>
                      <span className={cn("min-w-0 flex-1 text-[15px] leading-snug", on && "text-ink-soft line-through")}>{step}</span>
                    </button>
                    <button type="button" onClick={() => openAdd("voice", { kind: "story", prompt: step })} aria-label={`Record how you do this step: ${step}`} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-white">
                      <Icon name="mic" size={18} />
                    </button>
                  </li>
                );
              })}
            </ol>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Before the day, on Occasions: the lead's way into the checklist. Nothing for anyone else, or on the day. */
export function FestivalLeadEntry() {
  const { week } = useFestivalWeek();
  const [open, setOpen] = useState(false);
  if (!week || week.mode !== "lead" || week.daysLeft <= 0) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="press flex w-full items-center gap-3 rounded-card bg-card px-4 py-3 text-left shadow-card" style={week.accent ? { boxShadow: `0 24px 50px -26px ${week.accent}99` } : undefined}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-well text-ink">
          <Icon name="flower" size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-snug">You lead {week.title} this year</span>
          <span className="block text-[13px] text-ink-soft">{week.title} is {daysInWords(week.daysLeft)} · teach the steps</span>
        </span>
        <span className="text-[14px] font-semibold text-ink-soft">Steps</span>
      </button>
      <FestivalStepsSheet week={week} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* ---------------------------------------------------------------- the header */
export function FestivalHeader() {
  const { viewer, members } = useViewer();
  const { openAdd, refreshKey } = useShell();
  const { week } = useFestivalWeek();
  const { cards } = useFamilyCards(refreshKey);
  const [steps, setSteps] = useState(false);
  const photos = useMemo(() => {
    if (!week || !cards) return [];
    return week.pastPhotos.map((id) => cards.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  }, [week, cards]);
  // Quiet while loading, on failure and in the 50 weeks without a festival: no skeleton, so nothing shifts.
  if (!week) return null;
  const lead = members.find((x) => x.id === week.lead);
  const leadName = lead ? callName(lead) : "the family";
  const accent = week.accent && HEX.test(week.accent) ? week.accent : null;
  const lamp = lampGlowCss(week.lampAccent);

  const btn = "press inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-white no-underline";
  let line = `${leadName} leads this year`;
  let action: React.ReactNode = null;
  if (week.mode === "lead") {
    line = "You lead this year";
    action = (
      <button type="button" onClick={() => setSteps(true)} className={btn}>
        <Icon name="check" size={16} /> Teach the steps
      </button>
    );
  } else if (week.mode === "ask") {
    action = (
      <button type="button" onClick={() => openAdd("ask", null, [week.lead])} aria-label={`Ask ${leadName} how we do it, by voice`} className={btn}>
        <Icon name="mic" size={16} /> Ask {leadName} how we do it
      </button>
    );
  } else if (week.viewerWished) {
    line = "Your wish is in. It plays with everyone's on the day.";
  } else if (week.ritualRunId) {
    const runId = week.ritualRunId;
    action = (
      <button type="button" onClick={() => openAdd("voice", wishContribution(viewer.role, runId), null)} className={btn}>
        <Icon name="mic" size={16} /> Record your wish
      </button>
    );
  } else {
    action = (
      <Link href="/gather" className={btn}>
        Record your wish
      </Link>
    );
  }

  return (
    <>
    <section
      aria-label={`${week.title} week`}
      data-festival={week.slug}
      className="mt-5 overflow-hidden rounded-[26px] bg-card p-4"
      style={accent ? { backgroundImage: `linear-gradient(135deg, ${accent}33, ${accent}0d)`, boxShadow: `0 24px 50px -22px ${accent}88` } : { boxShadow: "var(--card-shadow)" }}
    >
      {lamp && <style>{lamp}</style>}
      {week.greeting && <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-soft">{week.greeting}</p>}
      <h2 className="m-0 mt-0.5 text-[22px] font-semibold leading-tight">
        {week.title} is {daysInWords(week.daysLeft)}
      </h2>

      {photos.length > 0 && (
        <Link href="/rituals" className="mt-3 block no-underline" aria-label={`See your family's ${week.title} from other years`}>
          <ul className="no-scrollbar -mx-4 m-0 flex list-none gap-2.5 overflow-x-auto px-4 pb-1">
            {photos.map((c) => (
              <li key={c.id} className="shrink-0">
                <span className="relative block h-[84px] w-[72px] overflow-hidden rounded-[14px] bg-surface">
                  <Photo src={cardCover(c, members)} alt="" sizes="144px" position="center 30%" />
                </span>
                <span className="tnum mt-1 block text-center text-[11.5px] text-ink-soft">{new Date(c.takenAt).getFullYear()}</span>
              </li>
            ))}
          </ul>
        </Link>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="m-0 min-w-0 flex-1 basis-[140px] text-[15px] font-medium leading-snug">{line}</p>
        {action}
      </div>
      {week.mode === "ask" && <p className="m-0 mt-2 text-[13px] text-ink-soft">{week.askForChildren}</p>}

    </section>
    <FestivalStepsSheet week={week} open={steps} onClose={() => setSteps(false)} />
    </>
  );
}
