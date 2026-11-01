"use client";

import { useState } from "react";
import { DOT, SafetyRow, type SafetyData } from "@/components/safety";
import { Avatar, Button, EmptyLine, Icon, RoomHeader, SectionTitle } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { callName, memberPhoto } from "@/lib/people";
import { emergencyFor, stateOf, type SafetyState } from "@/lib/safety";
import type { Member } from "@/lib/schemas";
import { ago, postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { placeFromTz } from "@/lib/zones";

// Safe & sound. Hers, not theirs: she turns it on, she picks who sees it,
// she can pause it. Families get calm status ("Home safe 11:40 PM"); an alert
// only when a promise is missed ("heading home by 11", no word at 11:20) or
// when she presses I need help. No tracking. Location only with "help".

const HEADING_ETAS = [15, 30, 45, 60, 90];
const JOURNEY_ETAS = [2, 4, 8, 12, 18];

export default function SafePage() {
  const { viewer, members } = useViewer();
  const { data, reload } = useJson<SafetyData>("/api/safety");
  const others = members.filter((m) => m.id !== viewer.id);
  const sharing = (data?.sharing ?? [])
    .map((id) => ({ member: members.find((m) => m.id === id), state: data ? stateOf(data.checkins, id) : null }))
    .filter((r): r is { member: Member; state: SafetyState | null } => Boolean(r.member));
  const sos = emergencyFor(viewer.tz);

  return (
    <div>
      <RoomHeader title="Safe & sound" subtitle="Let the people you choose know you got home. Not tracking: you tell them." />
      {!data ? (
        <div className="skeleton h-40 rounded-card" aria-busy="true" />
      ) : (
        <>
          {sharing.length > 0 && (
            <>
              <SectionTitle>Sharing with you</SectionTitle>
              <div className="space-y-2">
                {sharing.map(({ member, state }) =>
                  state ? (
                    <SafetyRow key={member.id} member={member} state={state} viewerTz={viewer.tz} />
                  ) : (
                    <div key={member.id} className="flex items-center gap-3 rounded-card bg-surface p-3.5">
                      <Avatar src={memberPhoto(member)} name={callName(member)} size={44} />
                      <p className="m-0 text-body text-ink-soft">{callName(member)} hasn&rsquo;t checked in yet</p>
                    </div>
                  ),
                )}
              </div>
              <History data={data} ids={sharing.map((s) => s.member.id)} />
            </>
          )}

          <SectionTitle>You</SectionTitle>
          {data.mine?.enabled ? <CheckIn data={data} onChange={reload} /> : <Setup others={others} current={data.mine} onSaved={reload} />}
          {data.mine?.enabled && <Setup others={others} current={data.mine} onSaved={reload} editing />}

          <SectionTitle>In an emergency</SectionTitle>
          <a href={`tel:${sos.number}`} className="press flex items-center gap-3 rounded-card bg-surface p-4 text-ink no-underline">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-black text-headline font-bold text-white">{sos.number}</span>
            <span className="min-w-0">
              <span className="block text-body font-semibold">Call {sos.number}</span>
              <span className="block text-footnote text-ink-soft">Emergency number for {sos.country}, from your time zone ({placeFromTz(viewer.tz)}). Call them first, then your family.</span>
            </span>
          </a>
        </>
      )}
    </div>
  );
}

/** The four buttons she actually needs, plus help. */
function CheckIn({ data, onChange }: { data: SafetyData; onChange: () => Promise<void> }) {
  const { viewer, members } = useViewer();
  const [mode, setMode] = useState<null | "heading" | "journey" | "help">(null);
  const [note, setNote] = useState("");
  const [shareLoc, setShareLoc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const state = stateOf(data.checkins, viewer.id);
  const open = state && state.tone !== "calm" ? state : null;
  const names = (data.mine?.watchers ?? []).map((id) => callName(members.find((m) => m.id === id))).join(" & ");

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const res = await postJson("/api/safety", { action: "checkin", note, ...body });
    setBusy(false);
    setMsg(res ? done : "Couldn't send. Try again.");
    setMode(null);
    setNote("");
    await onChange();
  }

  async function help() {
    setBusy(true);
    let location: { lat: number; lng: number; accuracy: number } | undefined;
    if (shareLoc && typeof navigator !== "undefined" && navigator.geolocation) {
      location = await new Promise((resolve) =>
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.min(100000, p.coords.accuracy) }),
          () => resolve(undefined),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
        ),
      );
    }
    await send({ kind: "help", location }, location ? `${names} can see you need help, and where you are (for 24 h).` : `${names} can see you need help.`);
  }

  return (
    <div className="space-y-3">
      {open && (
        <div className="rounded-card bg-surface p-4">
          <p className="m-0 flex items-center gap-2 text-body font-semibold">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[open.tone])} aria-hidden="true" />
            {open.label} · {ago(open.at)}
          </p>
          <p className="m-0 mt-0.5 text-footnote text-ink-soft">{names} can see this.</p>
          <Button
            className="mt-3 w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await postJson("/api/safety", { action: "close", checkinId: open.checkin.id });
              setBusy(false);
              setMsg(`${names} know you're okay.`);
              await onChange();
            }}
          >
            {open.checkin.kind === "journey" ? "Landed safe" : open.tone === "help" ? "I'm okay now" : "I'm home safe"}
          </Button>
        </div>
      )}
      {msg && <p className="m-0 rounded-card bg-surface px-4 py-3 text-callout text-ink" role="status">{msg}</p>}

      <div className="grid grid-cols-2 gap-2">
        <Big label="Home safe" sub="Tell them you're in" onClick={() => send({ kind: "home-safe" }, `${names} know you're home.`)} disabled={busy} />
        <Big label="Heading home" sub="With a time" active={mode === "heading"} onClick={() => setMode(mode === "heading" ? null : "heading")} />
        <Big label="Travelling" sub="Flight, train, drive" active={mode === "journey"} onClick={() => setMode(mode === "journey" ? null : "journey")} />
        <Big label="Out late" sub="No need to wait up" onClick={() => send({ kind: "out-late" }, `${names} know you're out late.`)} disabled={busy} />
      </div>

      {(mode === "heading" || mode === "journey") && (
        <div className="rounded-card bg-surface p-4">
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 120))} placeholder={mode === "heading" ? "From where? (optional)" : "Which flight or train? (optional)"} className="h-12 w-full rounded-2xl bg-white px-4 text-body outline-none" aria-label="Note" />
          <p className="m-0 mb-2 mt-3 text-footnote text-ink-soft">I should be there in</p>
          <div className="flex flex-wrap gap-2">
            {(mode === "heading" ? HEADING_ETAS : JOURNEY_ETAS).map((n) => (
              <button
                key={n}
                type="button"
                disabled={busy}
                onClick={() => send({ kind: mode, etaMinutes: mode === "heading" ? n : n * 60 }, `${names} will hear from Nearer only if you're not in by then.`)}
                className="press h-11 rounded-full bg-white px-4 text-body font-semibold"
              >
                {mode === "heading" ? `${n} min` : `${n} h`}
              </button>
            ))}
          </div>
          <p className="m-0 mt-3 text-caption text-ink-faint">If you don&rsquo;t tap &ldquo;home safe&rdquo; {mode === "heading" ? "20 minutes" : "2 hours"} after that, they&rsquo;ll see a gentle flag. Nothing else.</p>
        </div>
      )}

      {mode === "help" ? (
        <div className="frost rounded-card p-4">
          <p className="m-0 text-body font-semibold">Tell {names} you need help?</p>
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 120))} placeholder="What's happening? (optional)" className="mt-3 h-12 w-full rounded-2xl bg-white px-4 text-body outline-none" aria-label="What's happening" />
          <label className="mt-3 flex items-center gap-2 text-callout">
            <input type="checkbox" checked={shareLoc} onChange={(e) => setShareLoc(e.target.checked)} className="h-5 w-5" />
            Send where I am, once (deleted after 24 h)
          </label>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={help}>
              Send now
            </Button>
            <Button variant="quiet" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
          <a href="/nearby" className="mt-3 flex items-center gap-2 text-callout font-semibold text-ink no-underline">
            <Icon name="phone" size={16} /> Your top 5 nearby to call · Trusted nearby
          </a>
        </div>
      ) : (
        <button type="button" onClick={() => setMode("help")} className="press flex h-12 w-full items-center justify-center gap-2 rounded-full bg-surface text-body font-semibold text-ink">
          <span className="h-2.5 w-2.5 rounded-full bg-[#d92d20]" aria-hidden="true" />I need help
        </button>
      )}
    </div>
  );
}

function Big({ label, sub, onClick, disabled, active }: { label: string; sub: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn("press rounded-card p-4 text-left disabled:opacity-50", active ? "bg-black text-white" : "bg-surface text-ink")}>
      <span className="block text-body font-semibold">{label}</span>
      <span className={cn("block text-footnote", active ? "text-white/70" : "text-ink-soft")}>{sub}</span>
    </button>
  );
}

/** Turn on, choose people, pause, turn off. Always hers to change. */
function Setup({ others, current, onSaved, editing = false }: { others: Member[]; current: SafetyData["mine"]; onSaved: () => Promise<void>; editing?: boolean }) {
  const [open, setOpen] = useState(!editing);
  const [picked, setPicked] = useState<string[]>(current?.watchers ?? []);
  const [err, setErr] = useState<string | null>(null);
  async function save(enabled: boolean, paused = false) {
    const res = await postJson("/api/safety", { action: "settings", enabled, watchers: picked, paused });
    setErr(res ? null : "Pick at least one person.");
    if (res) {
      setOpen(!enabled ? true : false);
      await onSaved();
    }
  }
  if (editing && !open)
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" className="!h-11 !text-callout" onClick={() => setOpen(true)}>
          Who sees this
        </Button>
        <Button variant="secondary" className="!h-11 !text-callout" onClick={() => save(true, !current?.paused)}>
          {current?.paused ? "Resume sharing" : "Pause sharing"}
        </Button>
        {current?.paused && <p className="m-0 w-full text-footnote text-ink-soft">Paused. Nobody sees your check-ins until you resume.</p>}
      </div>
    );
  return (
    <div className="mt-3 rounded-card bg-surface p-4">
      {!editing && <p className="m-0 mb-3 text-body">Choose who sees when you&rsquo;re home safe. Only they see it, and you can pause or stop anytime.</p>}
      <div className="flex flex-wrap gap-2">
        {others.length === 0 && <EmptyLine>Invite family first.</EmptyLine>}
        {others.map((m) => {
          const on = picked.includes(m.id);
          return (
            <button key={m.id} type="button" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((x) => x !== m.id) : [...picked, m.id])} className={cn("press flex h-11 items-center gap-2 rounded-full pl-1 pr-4 text-body", on ? "bg-black text-white" : "bg-white text-ink")}>
              <Avatar src={memberPhoto(m)} name={callName(m)} size={34} />
              {callName(m)}
            </button>
          );
        })}
      </div>
      {err && <p className="m-0 mt-2 text-footnote text-[#a32418]">{err}</p>}
      <div className="mt-4 flex gap-2">
        <Button className="flex-1" disabled={picked.length === 0} onClick={() => save(true)}>
          {editing ? "Save" : "Turn on"}
        </Button>
        {editing && (
          <Button variant="quiet" onClick={() => save(false)}>
            Turn off
          </Button>
        )}
      </div>
    </div>
  );
}

function History({ data, ids }: { data: SafetyData; ids: string[] }) {
  const { members, viewer } = useViewer();
  const items = data.checkins.filter((c) => ids.includes(c.memberId)).slice(0, 8);
  if (items.length < 2) return null;
  const LABEL = { "home-safe": "Home safe", heading: "Heading home", journey: "Travelling", "out-late": "Out late", help: "Asked for help" } as const;
  return (
    <details className="mt-2 rounded-card bg-surface px-4 py-3">
      <summary className="cursor-pointer text-callout font-medium text-ink-soft">Recent check-ins</summary>
      <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
        {items.map((c) => (
          <li key={c.id} className="flex justify-between gap-3 text-callout">
            <span className="truncate">
              {callName(members.find((m) => m.id === c.memberId))} · {LABEL[c.kind]}
              {c.note ? ` · ${c.note}` : ""}
            </span>
            <span className="shrink-0 text-ink-faint">{ago(c.at)}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-2 text-caption text-ink-faint">Shown in your time ({placeFromTz(viewer.tz)}).</p>
    </details>
  );
}
