"use client";

import { useState } from "react";
import { bestSlot, fmtIn, participants, type FamilyEvent } from "@/lib/events";
import { eventAction } from "@/lib/gather-client";
import { callName } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { placeFromTz } from "@/lib/zones";
import { DEFAULT_VENUE, type VenueId } from "@/lib/venues";
import { AvatarStack } from "./event-card";
import { Icon } from "./ui/kit";
import { VenuePicker } from "./venue-scene";

/**
 * Three times that work in every home (8 AM–10 PM local). One tap each:
 * "this works for me". When most can make one, it locks on its own.
 */
export function AvailabilityPicker({ e, members, viewer, onChange }: { e: FamilyEvent; members: Member[]; viewer: Member; onChange: (next: FamilyEvent) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [venue, setVenue] = useState<VenueId>(DEFAULT_VENUE);
  const isHost = e.hostId === viewer.id;
  const total = participants(e).length;
  const best = bestSlot(e);
  const others = new Map<string, string[]>();
  for (const m of members.filter((x) => participants(e).includes(x.id) && x.tz !== viewer.tz && x.tz && x.tz !== "UTC")) others.set(m.tz, [...(others.get(m.tz) ?? []), callName(m)]);
  const act = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    const out = await eventAction({ eventId: e.id, ...body });
    setBusy(null);
    if (out?.event) onChange(out.event);
  };

  if (e.slots.length === 0) {
    return <p className="m-0 rounded-[20px] bg-black/[.04] px-4 py-4 text-[15px] text-ink-soft">No hour that day has every home awake. Try another day.</p>;
  }
  const pickedNone = e.answered.includes(viewer.id) && !Object.values(e.votes).some((v) => v.includes(viewer.id));
  return (
    <section id="times" aria-label="Pick the times that work for you">
      {isHost && (
        <div className="mb-3 rounded-[22px] bg-[#1c1b1a] p-3 text-white">
          <p className="m-0 mb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-white/55">Where shall we sit?</p>
          <VenuePicker value={venue} onChange={setVenue} />
        </div>
      )}
      <ul className="m-0 list-none space-y-2 p-0">
        {e.slots.map((s) => {
          const voters = e.votes[s.id] ?? [];
          const mine = voters.includes(viewer.id);
          const lead = best?.slot.id === s.id && best.count > 0;
          return (
            <li key={s.id} className={cn("flex items-center gap-2 rounded-[22px] p-1.5 pr-2 transition-colors", mine ? "bg-[#1c1b1a] text-white" : "bg-black/[.04]")}>
              <button type="button" aria-pressed={mine} disabled={busy !== null} onClick={() => void act({ action: "vote", slotId: s.id, ...(isHost ? { venue } : {}) }, s.id)} className="press flex min-w-0 flex-1 items-center gap-3 rounded-[18px] px-3 py-2.5 text-left disabled:opacity-60">
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full border", mine ? "border-white bg-white text-[#1c1b1a]" : "border-black/20")} aria-hidden="true">
                  {mine && <Icon name="check" size={18} strokeWidth={2.5} />}
                </span>
                <span className="min-w-0">
                  <span className="tnum block text-[17px] font-semibold">
                    {fmtIn(viewer.tz, s.startsAt, { weekday: "short", day: "numeric", month: "short" })} · {fmtIn(viewer.tz, s.startsAt, { hour: "numeric", minute: "2-digit" })}
                  </span>
                  <span className={cn("tnum block truncate text-[13px]", mine ? "text-white/65" : "text-ink-soft")}>
                    {others.size ? Array.from(others.keys()).map((tz) => `${placeFromTz(tz)} ${fmtIn(tz, s.startsAt, { hour: "numeric", minute: "2-digit" })}`).join(" · ") : "Same time in every home"}
                  </span>
                </span>
              </button>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <AvatarStack ids={voters} members={members} size={22} max={3} tone={mine ? "dark" : "light"} />
                <span className={cn("tnum text-[12px] font-semibold", mine ? "text-white/70" : "text-ink-faint")} aria-label={`${voters.length} of ${total} can make it`}>
                  {voters.length}/{total}
                  {lead && <span className="sr-only"> most picked</span>}
                </span>
              </span>
              {isHost && voters.length > 0 && (
                <button type="button" aria-label="Lock this time" disabled={busy !== null} onClick={() => void act({ action: "lock", slotId: s.id, venue }, `lock-${s.id}`)} className={cn("press grid h-10 w-10 shrink-0 place-items-center rounded-full", mine ? "bg-white/15 text-white" : "bg-white text-ink")}>
                  <Icon name="key" size={18} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between px-1">
        <p className="m-0 text-[12px] text-ink-faint">Locks when most can make it</p>
        <button type="button" aria-pressed={pickedNone} disabled={busy !== null} onClick={() => void act({ action: "none" }, "none")} className={cn("press h-9 rounded-full px-3 text-[13px] font-semibold", pickedNone ? "bg-black/[.08] text-ink" : "text-ink-soft")}>
          None work
        </button>
      </div>
    </section>
  );
}
