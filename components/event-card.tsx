"use client";

import Link from "next/link";
import { fmtIn, isLive, lockedStart, participants, startsInLabel, type FamilyEvent } from "@/lib/events";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { placeFromTz } from "@/lib/zones";
import { Avatar, Icon } from "./ui/kit";

export const INK = "#1c1b1a";
export const PAPER = "#f6f3ee";

/** Who is coming: everyone who said a locked (or the leading) slot works, plus the host. */
export function comingIds(e: FamilyEvent): string[] {
  if (e.lockedSlotId) return Array.from(new Set([e.hostId, ...(e.votes[e.lockedSlotId] ?? [])]));
  return Array.from(new Set(Object.values(e.votes).flat()));
}

export function AvatarStack({ ids, members, size = 30, max = 6, tone = "light" }: { ids: string[]; members: Member[]; size?: number; max?: number; tone?: "light" | "dark" }) {
  const people = ids.map((id) => members.find((m) => m.id === id)).filter((m): m is Member => Boolean(m));
  if (!people.length) return null;
  return (
    <span className="flex items-center" aria-label={people.map((p) => callName(p)).join(", ")}>
      {people.slice(0, max).map((p, i) => (
        <span key={p.id} className="rounded-full" style={{ marginLeft: i ? -size * 0.3 : 0, boxShadow: `0 0 0 2px ${tone === "dark" ? INK : PAPER}` }}>
          <Avatar src={memberPhoto(p)} name={callName(p)} size={size} />
        </span>
      ))}
      {people.length > max && <span className={cn("ml-1.5 text-footnote font-semibold", tone === "dark" ? "text-white/70" : "text-ink-soft")}>+{people.length - max}</span>}
    </span>
  );
}

/** Your time large; every other home's time under it ("London · 2:30 PM"). */
export function EventTimes({ at, members, viewer, ids, tone = "light", size = "lg" }: { at: Date; members: Member[]; viewer: Member; ids: string[]; tone?: "light" | "dark"; size?: "lg" | "sm" }) {
  const zones = new Map<string, string[]>();
  for (const m of members.filter((x) => ids.includes(x.id) && x.tz && x.tz !== "UTC" && x.tz !== viewer.tz)) zones.set(m.tz, [...(zones.get(m.tz) ?? []), callName(m)]);
  const soft = tone === "dark" ? "text-white/60" : "text-ink-soft";
  return (
    <div>
      <p data-display className={cn("tnum m-0 font-light leading-tight tracking-[-0.01em]", size === "lg" ? "text-display" : "text-headline font-normal")}>
        {fmtIn(viewer.tz, at, { weekday: "short", day: "numeric", month: "short" })} · {fmtIn(viewer.tz, at, { hour: "numeric", minute: "2-digit" })}
      </p>
      {zones.size === 0 ? (
        <p className={cn("m-0 mt-0.5 text-footnote", soft)}>Same time in every home</p>
      ) : (
        Array.from(zones.entries()).map(([tz, names]) => (
          <p key={tz} className={cn("tnum m-0 mt-0.5 text-footnote", soft)}>
            {placeFromTz(tz)} · {fmtIn(tz, at, { weekday: "short", hour: "numeric", minute: "2-digit" })}
            <span className="opacity-70"> · {names.slice(0, 2).join(", ")}{names.length > 2 ? ` +${names.length - 2}` : ""}</span>
          </p>
        ))
      )}
    </div>
  );
}

export function JoinButton({ e, className }: { e: FamilyEvent; className?: string }) {
  if (!e.sittingId) return null;
  return (
    // Through our own call page: its pre-join asks before any microphone or camera starts.
    <Link href={`/call/${encodeURIComponent(e.sittingId)}`} className={cn("press flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-body font-semibold text-[#1c1b1a] no-underline", className)}>
      <Icon name="video" size={20} />
      Join
    </Link>
  );
}

/** The top card on /gather: the next event, in ink. */
export function EventHero({ e, members, viewer, now = new Date() }: { e: FamilyEvent; members: Member[]; viewer: Member; now?: Date }) {
  const start = lockedStart(e);
  const live = isLive(e, now);
  const answered = e.answered.includes(viewer.id);
  const total = participants(e).length;
  return (
    <article className="relative overflow-hidden rounded-[28px] p-4 text-white" style={{ background: INK }}>
      {live && <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,184,77,.35), transparent 70%)" }} />}
      <Link href={`/gather/${e.id}`} className="block text-white no-underline">
        <div className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.08em] text-white/55">
          {live ? (
            <>
              <span className="h-2 w-2 rounded-full bg-[#ffb84d]" style={{ boxShadow: "0 0 0 4px rgba(255,184,77,.25)" }} aria-hidden="true" />
              Live now
            </>
          ) : start ? (
            startsInLabel(start, now)
          ) : (
            "Picking a time"
          )}
        </div>
        <h2 className="m-0 mt-2 text-title font-normal leading-tight">{e.title}</h2>
        <div className="mt-4">
          {start ? (
            <EventTimes at={start} members={members} viewer={viewer} ids={participants(e)} tone="dark" />
          ) : (
            <p className="m-0 text-body text-white/70">
              {Object.values(e.votes).flat().length ? `${new Set(Object.values(e.votes).flat()).size} of ${total} have picked` : "Nobody has picked yet"}
            </p>
          )}
        </div>
      </Link>
      <div className="mt-5 flex items-center justify-between gap-3">
        <AvatarStack ids={comingIds(e)} members={members} tone="dark" />
        {live ? (
          <JoinButton e={e} />
        ) : !start && !answered ? (
          <Link href={`/gather/${e.id}#times`} className="press flex h-11 items-center gap-2 rounded-full bg-white px-5 text-body font-semibold text-[#1c1b1a] no-underline">
            <Icon name="calendar" size={18} />
            Pick a time
          </Link>
        ) : (
          <Link href={`/gather/${e.id}`} aria-label="Open the plan" className="press grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white no-underline">
            <Icon name="chevron" />
          </Link>
        )}
      </div>
    </article>
  );
}

/** A smaller card for the swipe row of other events. */
export function EventMini({ e, members, viewer }: { e: FamilyEvent; members: Member[]; viewer: Member }) {
  const start = lockedStart(e);
  return (
    <Link href={`/gather/${e.id}`} className="block h-full rounded-[22px] bg-tint p-4 text-ink no-underline">
      <p className="m-0 truncate text-body font-semibold">{e.title}</p>
      <p className="tnum m-0 mt-1 text-footnote text-ink-soft">
        {start ? fmtIn(viewer.tz, start, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : `Around ${new Date(`${e.date}T12:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" })} · picking a time`}
      </p>
      <div className="mt-3">
        <AvatarStack ids={comingIds(e)} members={members} size={24} />
      </div>
    </Link>
  );
}
