"use client";

import type { SafetyCheckin, SafetySettings } from "@/lib/kinds";
import { callName, memberPhoto } from "@/lib/people";
import { emergencyFor, mapsLink, stateOf, type SafetyState } from "@/lib/safety";
import type { Member } from "@/lib/schemas";
import { ago, postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { timeIn } from "@/lib/zones";
import { Avatar, Icon } from "./ui/kit";
import { useViewer } from "./viewer";

/** One person at a glance (GET /api/safety `members`): for the home screen's status dots. */
export interface SafetyGlance {
  memberId: string;
  /** null = sharing, but no check-in yet. */
  tone: SafetyState["tone"] | null;
  label: string | null;
  at: string | null;
  etaAt: string | null;
  /** Newest first, at most 5. */
  recent: SafetyCheckin[];
}

export interface SafetyData {
  mine: SafetySettings | null;
  sharing: string[];
  checkins: SafetyCheckin[];
  members?: SafetyGlance[];
}

export const TONE: Record<SafetyState["tone"], { bg: string; ink: string }> = {
  calm: { bg: "bg-surface", ink: "text-ink-soft" },
  pending: { bg: "bg-surface", ink: "text-ink-soft" },
  overdue: { bg: "bg-surface", ink: "text-ink" },
  help: { bg: "bg-surface", ink: "text-[#a32418]" },
};

/** Status colour lives only on the dot: green ok, amber waiting/late, red help. */
export const DOT: Record<SafetyState["tone"], string> = { calm: "bg-[#2f9e5b]", pending: "bg-[#d99a1e]", overdue: "bg-[#d99a1e]", help: "bg-[#d92d20]" };

function clock(iso: string, tz: string): string {
  return timeIn(tz, new Date(iso));
}

/** One person's status, as the people they chose see it. */
export function SafetyRow({ member, state, viewerTz, compact = false }: { member: Member; state: SafetyState; viewerTz: string; compact?: boolean }) {
  const t = TONE[state.tone];
  const loc = state.tone === "help" ? state.checkin.location : null;
  const sos = emergencyFor(member.tz);
  const detail =
    state.tone === "pending"
      ? `expected by ${clock(state.etaAt, viewerTz)} your time${state.checkin.note ? ` · ${state.checkin.note}` : ""}`
      : state.tone === "overdue"
        ? `was due by ${clock(state.etaAt, viewerTz)} your time. Maybe give a call.`
        : state.tone === "help"
          ? state.checkin.note || "Pressed I need help."
          : ago(state.at);
  return (
    <div className={cn("rounded-card p-3.5", t.bg)} role={state.tone === "help" || state.tone === "overdue" ? "alert" : undefined}>
      <div className="flex items-center gap-3">
        <Avatar src={memberPhoto(member)} name={callName(member)} size={compact ? 40 : 44} ring />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-body font-semibold">
            {callName(member)} · {state.label}
          </p>
          <p className={cn("m-0 truncate text-footnote", t.ink)}>{detail}</p>
        </div>
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[state.tone])} aria-label={state.label} />
      </div>
      {(state.tone === "help" || state.tone === "overdue") && (
        <div className="mt-3 flex flex-wrap gap-2">
          {loc && (
            <a href={mapsLink(loc)} target="_blank" rel="noreferrer" className="press flex h-10 items-center rounded-full bg-accent px-4 text-callout font-semibold text-accent-ink no-underline">
              See location · sent {ago(loc.at)}
            </a>
          )}
          <a href={`tel:${sos.number}`} className="press flex h-10 items-center rounded-full bg-surface px-4 text-callout font-semibold text-ink no-underline">
            Emergency in {sos.country}: {sos.number}
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * Courtyard block: only alerts (a missed arrival, a call for help) and your own
 * open trip. Everyday "home safe" shows as the green dot on the window.
 */
export function SafetyWatch() {
  const { viewer, members } = useViewer();
  const { data, reload } = useJson<SafetyData>("/api/safety");
  if (!data) return null;
  const rows = data.sharing
    .map((id) => ({ member: members.find((m) => m.id === id), state: stateOf(data.checkins, id) }))
    .filter((r): r is { member: Member; state: SafetyState } => Boolean(r.member && r.state));
  const mine = data.mine?.enabled ? stateOf(data.checkins, viewer.id) : null;
  const open = mine && (mine.tone === "pending" || mine.tone === "overdue" || mine.tone === "help") ? mine : null;
  // Calm "home safe" lines live on the window's status dots now; here only
  // what needs someone: a missed arrival, a call for help, your own trip.
  if (!rows.some((r) => r.state.tone !== "calm") && !open) return null;
  // Alerts first; calm rows only as a single quiet line.
  const loud = rows.filter((r) => r.state.tone !== "calm");
  return (
    <div className="space-y-2">
      {open && (
        <div className="flex items-center gap-3 rounded-card bg-surface p-3.5">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[open.tone])} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1 truncate text-body font-semibold">{open.tone === "help" ? "Your family can see you asked for help" : "On your way. Tell them when you're in."}</p>
          <button
            type="button"
            onClick={async () => {
              await postJson("/api/safety", { action: "close", checkinId: open.checkin.id });
              await reload();
            }}
            className="press h-10 shrink-0 rounded-full bg-accent px-4 text-callout font-semibold text-accent-ink"
          >
            {open.checkin.kind === "journey" ? "Landed" : open.tone === "help" ? "I'm okay" : "Home safe"}
          </button>
        </div>
      )}
      {loud.map((r) => (
        <SafetyRow key={r.member.id} member={r.member} state={r.state} viewerTz={viewer.tz} />
      ))}
    </div>
  );
}
