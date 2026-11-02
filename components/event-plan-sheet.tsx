"use client";

import { useEffect, useState } from "react";
import { eventTypeLabel, type EventType, type FamilyEvent } from "@/lib/events";
import { eventAction } from "@/lib/gather-client";
import type { UpcomingOccasion } from "@/lib/gather-prompts";
import { addDays, whenLabel } from "@/lib/occasion-calendar";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { isAdmin } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Avatar, Button, Icon, type IconName } from "./ui/kit";
import { BottomSheet } from "./ui/bottom-sheet";

// Visits are planned on Celebrations → Visits, so they are not offered here.
const OTHER: { type: EventType; icon: IconName; placeholder: string }[] = [
  { type: "anniversary", icon: "heart", placeholder: "Maa & Papa's anniversary" },
  { type: "custom", icon: "sparkle", placeholder: "Papa's retirement" },
];

export interface PlanPreset {
  occasion?: UpcomingOccasion;
  type?: EventType;
  title?: string;
}

type What = { kind: "occasion"; o: UpcomingOccasion } | { kind: "other"; type: EventType };

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "Plan an event": what, for whom, roughly when. Then Muse drafts it all. */
export function PlanSheet({ open, onClose, occasions, members, viewer, preset, onCreated }: { open: boolean; onClose: () => void; occasions: UpcomingOccasion[]; members: Member[]; viewer: Member; preset?: PlanPreset; onCreated: (e: FamilyEvent) => void }) {
  const [what, setWhat] = useState<What | null>(null);
  const [title, setTitle] = useState("");
  const [forId, setForId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(addDays(isoToday(), 7));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Off by default: the plan is wishes, songs and photos. Only an owner or admin can ask for a cake or gift.
  const [extras, setExtras] = useState(false);
  const mayAddExtras = isAdmin(viewer);
  const wishable = occasions.filter((o) => o.kind !== "national" || o.days <= 30).slice(0, 8);

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    setBusy(false);
    setExtras(false);
    if (preset?.occasion) choose({ kind: "occasion", o: preset.occasion });
    else if (preset?.type) {
      setWhat({ kind: "other", type: preset.type });
      setTitle(preset.title ?? "");
      setForId(null);
    } else {
      setWhat(null);
      setTitle("");
      setForId(null);
      setDate(addDays(isoToday(), 7));
    }
  }, [open, preset]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(w: What) {
    setWhat(w);
    if (w.kind === "occasion") {
      setForId(w.o.memberId);
      setDate(w.o.date);
      setTitle("");
    } else {
      setForId(null);
    }
  }

  const type: EventType | null = what ? (what.kind === "occasion" ? what.o.type : what.type) : null;
  const needsTitle = what?.kind === "other" && what.type === "custom";
  const ready = Boolean(type) && (!needsTitle || title.trim().length >= 2) && Boolean(date);
  const dateChips = [
    { label: "This weekend", iso: nextWeekday(6) },
    { label: "Next week", iso: addDays(isoToday(), 7) },
    { label: "In 2 weeks", iso: addDays(isoToday(), 14) },
  ];

  const submit = async () => {
    if (!type || !what) return;
    setBusy(true);
    setFailed(false);
    const out = await eventAction({
      action: "create",
      type,
      date,
      occasionKey: what.kind === "occasion" ? what.o.slug : null,
      forMemberId: forId,
      extras: mayAddExtras && extras,
      ...(title.trim().length >= 2 ? { title: title.trim() } : {}),
    });
    setBusy(false);
    if (out?.event) onCreated(out.event);
    else setFailed(true);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Plan an event" dataUi="event-plan-sheet" z={50}>
            {busy ? (
              <div aria-busy="true" aria-label="Drafting the plan" className="space-y-3 pb-4">
                <p className="voice m-0 text-headline text-ink-soft">Drafting the plan, the tasks and the songs…</p>
                <div className="skeleton h-16 rounded-[20px]" />
                <div className="skeleton h-16 rounded-[20px]" />
                <div className="skeleton h-16 rounded-[20px]" />
              </div>
            ) : (
              <>
                <Step n={1} label="What">
                  <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                    {wishable.map((o) => {
                      const on = what?.kind === "occasion" && what.o.key === o.key;
                      return (
                        <button key={o.key} type="button" aria-pressed={on} onClick={() => choose({ kind: "occasion", o })} className={cn("press flex w-[136px] shrink-0 flex-col items-start rounded-[20px] p-3 text-left", on ? "bg-deep text-white" : "bg-white")}>
                          {o.memberId ? <Avatar src={memberPhoto(members.find((m) => m.id === o.memberId))} name={o.label} size={30} /> : <span className={cn("grid h-[30px] w-[30px] place-items-center rounded-full", on ? "bg-white/15" : "bg-tint")}><Icon name="lamp" size={16} /></span>}
                          <span className="mt-2 line-clamp-2 text-callout font-semibold leading-tight">{o.label}</span>
                          <span className={cn("mt-0.5 text-caption", on ? "text-white/60" : "text-ink-faint")}>{whenLabel(o.days, o.date)}</span>
                        </button>
                      );
                    })}
                    {OTHER.map((x) => {
                      const on = what?.kind === "other" && what.type === x.type;
                      return (
                        <button key={x.type} type="button" aria-pressed={on} onClick={() => choose({ kind: "other", type: x.type })} className={cn("press flex w-[112px] shrink-0 flex-col items-start rounded-[20px] p-3 text-left", on ? "bg-deep text-white" : "bg-white")}>
                          <span className={cn("grid h-[30px] w-[30px] place-items-center rounded-full", on ? "bg-white/15" : "bg-tint")}><Icon name={x.icon} size={16} /></span>
                          <span className="mt-2 text-callout font-semibold leading-tight">{eventTypeLabel(x.type)}</span>
                        </button>
                      );
                    })}
                  </div>
                  {what?.kind === "other" && (
                    <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={OTHER.find((x) => x.type === what.type)?.placeholder} aria-label="Name it" className="mt-2 h-12 w-full rounded-full bg-white px-5 text-body outline-none focus:ring-2 focus:ring-black/20" />
                  )}
                </Step>

                <Step n={2} label="For whom">
                  <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4" role="radiogroup" aria-label="For whom">
                    <button type="button" role="radio" aria-checked={forId === null} onClick={() => setForId(null)} className={cn("press flex w-[64px] shrink-0 flex-col items-center gap-1 rounded-[16px] p-1.5 text-caption font-semibold", forId === null ? "bg-deep text-white" : "")}>
                      <span className={cn("grid h-11 w-11 place-items-center rounded-full", forId === null ? "bg-white/15" : "bg-white")}><Icon name="gather" size={20} /></span>
                      Everyone
                    </button>
                    {members.map((m) => (
                      <button key={m.id} type="button" role="radio" aria-checked={forId === m.id} onClick={() => setForId(m.id)} className={cn("press flex w-[64px] shrink-0 flex-col items-center gap-1 rounded-[16px] p-1.5 text-caption font-semibold", forId === m.id ? "bg-deep text-white" : "")}>
                        <Avatar src={memberPhoto(m)} name={callName(m)} size={44} />
                        <span className="w-full truncate text-center">{m.id === viewer.id ? "You" : callName(m)}</span>
                      </button>
                    ))}
                  </div>
                </Step>

                <Step n={3} label="Roughly when">
                  <div className="flex flex-wrap gap-2">
                    {what?.kind === "occasion" && (
                      <Chip on={date === what.o.date} onClick={() => setDate(what.o.date)}>
                        On the day
                      </Chip>
                    )}
                    {dateChips.map((c) => (
                      <Chip key={c.label} on={date === c.iso && !(what?.kind === "occasion" && what.o.date === c.iso)} onClick={() => setDate(c.iso)}>
                        {c.label}
                      </Chip>
                    ))}
                    <label className="relative">
                      <span className="sr-only">Pick a date</span>
                      <input type="date" value={date} min={isoToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-10 rounded-full bg-white px-4 text-callout font-semibold outline-none" />
                    </label>
                  </div>
                </Step>

                {mayAddExtras && (
                  <label className="mt-5 flex min-h-11 cursor-pointer items-center gap-3 text-body">
                    <input type="checkbox" checked={extras} onChange={(e) => setExtras(e.target.checked)} className="h-5 w-5 accent-[#1c1b1a]" />
                    Also plan a cake, flowers or sweets
                  </label>
                )}
                {failed && <p className="m-0 mt-3 text-callout text-[#b42318]" role="alert">Couldn&rsquo;t draft it just now. Try again.</p>}
                <Button className="mt-6 w-full" disabled={!ready} onClick={() => void submit()}>
                  <Icon name="sparkle" size={18} />
                  Draft the plan
                </Button>
              </>
            )}
    </BottomSheet>
  );
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="m-0 mb-2 flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.08em] text-ink-faint">
        <span className="tnum grid h-5 w-5 place-items-center rounded-full bg-tint text-caption">{n}</span>
        {label}
      </p>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("press h-10 rounded-full px-4 text-callout font-semibold", on ? "bg-deep text-white" : "bg-white")}>
      {children}
    </button>
  );
}

/** The next given weekday (0 Sun … 6 Sat), at least 2 days away. */
function nextWeekday(day: number): string {
  const now = new Date();
  let d = (day - now.getUTCDay() + 7) % 7;
  if (d < 2) d += 7;
  return addDays(isoToday(), d);
}
