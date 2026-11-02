"use client";

import { useEffect, useMemo, useState } from "react";
import { holidayVisible, whenLabel, daysBetween, type CalHoliday, type OccasionChoices } from "@/lib/occasion-calendar";
import { postJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { Button, Icon } from "./ui/kit";
import { BottomSheet } from "./ui/bottom-sheet";

// "Which traditions does your family celebrate?": one optional,
// family-level choice, used only to show festivals on the calendar. Each
// festival can also be switched on or off by hand (kept / skipped).
// Children see it but can't change it.

export interface TraditionChoice {
  id: string;
  label: string;
  exclusive: boolean;
}

export function TraditionsSheet({
  open,
  choices,
  holidays,
  value,
  today,
  sourceLine,
  canEdit,
  onClose,
  onSaved,
}: {
  open: boolean;
  choices: TraditionChoice[];
  /** Every mapped holiday for the family's country. */
  holidays: CalHoliday[];
  value: OccasionChoices;
  today: string;
  sourceLine: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (v: OccasionChoices) => void;
}) {
  const [picked, setPicked] = useState<OccasionChoices>(value);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [byHand, setByHand] = useState(false);
  useEffect(() => {
    if (open) {
      setPicked(value);
      setFailed(false);
      setByHand(false);
    }
  }, [open, value]);

  const toggleTradition = (c: TraditionChoice) =>
    setPicked((p) => {
      const on = p.traditions.includes(c.id);
      if (on) return { ...p, traditions: p.traditions.filter((t) => t !== c.id) };
      if (c.exclusive) return { ...p, traditions: [c.id] };
      const exclusive = new Set(choices.filter((x) => x.exclusive).map((x) => x.id));
      return { ...p, traditions: [...p.traditions.filter((t) => !exclusive.has(t)), c.id] };
    });

  // The next date of each festival in the coming year, one row per festival.
  const nextUp = useMemo(() => {
    const seen = new Map<string, CalHoliday>();
    for (const h of holidays) {
      if (h.date < today || daysBetween(today, h.date) > 366) continue;
      if (!seen.has(h.key)) seen.set(h.key, h);
    }
    return Array.from(seen.values());
  }, [holidays, today]);

  const toggleFestival = (h: CalHoliday) =>
    setPicked((p) => {
      const now = holidayVisible(h, p);
      const kept = p.kept.filter((k) => k !== h.key);
      const skipped = p.skipped.filter((k) => k !== h.key);
      const base = holidayVisible(h, { traditions: p.traditions, kept: [], skipped: [] });
      // Only store an override when it differs from what the traditions give.
      if (now) return { ...p, kept, skipped: base ? [...skipped, h.key] : skipped };
      return { ...p, skipped, kept: base ? kept : [...kept, h.key] };
    });

  const shown = nextUp.filter((h) => holidayVisible(h, picked));

  return (
    <BottomSheet open={open} onClose={onClose} title="Our traditions" z={50}>
            <p className="m-0 mt-1.5 text-callout text-ink-soft">Which ones does your family celebrate? Used only to show your festivals; change it anytime.</p>

            <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Traditions">
              {choices.map((c) => {
                const on = picked.traditions.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={!canEdit}
                    onClick={() => toggleTradition(c)}
                    className={cn("press flex h-12 items-center gap-2 rounded-[16px] px-4 text-left text-body font-semibold disabled:opacity-60", on ? "bg-accent text-accent-ink" : "bg-white text-ink")}
                  >
                    <span className="min-w-0 flex-1">{c.label}</span>
                    <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full", on ? "bg-white text-black" : "ring-1 ring-black/20")} aria-hidden="true">
                      {on && <Icon name="check" size={12} />}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="m-0 mt-4 text-footnote text-ink-soft">
              Birthdays and national days are always on.{" "}
              {shown.filter((h) => h.kind === "festival").length > 0
                ? `${shown.filter((h) => h.kind === "festival").length} festivals in the coming year.`
                : "No festivals yet."}
            </p>

            <button type="button" onClick={() => setByHand((b) => !b)} aria-expanded={byHand} className="press mt-2 flex h-11 w-full items-center gap-2 rounded-[14px] bg-white/70 px-4 text-left text-callout font-semibold">
              <Icon name="calendar" size={18} className="text-ink-soft" />
              <span className="flex-1">Choose festivals one by one</span>
              <Icon name={byHand ? "up" : "down"} size={18} className="text-ink-faint" />
            </button>
            {byHand && (
              <ul className="m-0 mt-2 list-none space-y-1 p-0">
                {nextUp.map((h) => {
                  const on = holidayVisible(h, picked);
                  return (
                    <li key={h.key}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        disabled={!canEdit}
                        onClick={() => toggleFestival(h)}
                        className="press flex min-h-[48px] w-full items-center gap-3 rounded-[14px] bg-white px-4 py-1.5 text-left disabled:opacity-60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-body font-semibold">{h.title}</span>
                          <span className="block text-caption text-ink-soft">{whenLabel(daysBetween(today, h.date), h.date)}</span>
                        </span>
                        <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", on ? "bg-ink" : "bg-black/15")} aria-hidden="true">
                          <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left]", on ? "left-[18px]" : "left-0.5")} />
                        </span>
                      </button>
                    </li>
                  );
                })}
                {nextUp.length === 0 && <li className="py-3 text-center text-callout text-ink-soft">No dates found for the coming year.</li>}
              </ul>
            )}

            <p className="m-0 mt-3 text-caption text-ink-faint">{sourceLine}</p>
            {failed && <p className="m-0 mt-3 text-callout text-[#b42318]">Couldn&rsquo;t save. Try again.</p>}
            {canEdit ? (
              <Button
                className="mt-4 w-full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const out = await postJson<OccasionChoices>("/api/rituals", { action: "traditions", ...picked });
                  setBusy(false);
                  if (!out) return setFailed(true);
                  onSaved(out);
                  onClose();
                }}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            ) : (
              <p className="m-0 mt-4 text-center text-footnote text-ink-faint">A grown-up in the family can change this.</p>
            )}
    </BottomSheet>
  );
}
