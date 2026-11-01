"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Icon } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import type { Knock, WeeklyCall } from "@/lib/kinds";
import { callName } from "@/lib/people";
import { postJson, useJson } from "@/lib/use-json";
import { callLabel, farZone, nextOccurrence, WEEKDAYS } from "@/lib/weekly-call";
import { hourIn } from "@/lib/zones";

// Coming up → "Our weekly call": one named ritual ("Sunday chai") at the same
// hour every week, shown in your clock and the far home's. Not a task.

const FIELD = "h-11 w-full rounded-[14px] bg-well px-3 text-body outline-none focus:ring-2 focus:ring-marigold";

/** Weekday and clock time of the next call, in the viewer's own zone. */
function inZone(call: WeeklyCall, tz: string): { weekday: number; time: string } {
  const at = nextOccurrence(call);
  const h = Math.floor(hourIn(tz, at));
  const mi = Math.round((hourIn(tz, at) - h) * 60);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at);
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), time: `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
}

export function WeeklyCallCard() {
  const router = useRouter();
  const { viewer, members } = useViewer();
  const { data, failed, reload } = useJson<{ call: WeeklyCall | null; canSet: boolean }>("/api/gather/weekly-call");
  const sit = useJson<{ knocks: Knock[] }>("/api/sit");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (failed) return null;
  if (!data) return <div className="skeleton mt-4 h-[148px] rounded-card" aria-busy="true" aria-label="Loading" />;
  const { call, canSet } = data;
  if (!call && !canSet) return null;

  const host = members.find((m) => m.id === call?.hostId);
  const far = call ? farZone(viewer.tz, host?.tz, members.map((m) => m.tz)) : null;

  const startNow = async () => {
    const open = sit.data?.knocks?.[0];
    if (open) return router.push(`/call/${open.id}`);
    setBusy(true);
    const out = await postJson<{ knock: Knock }>("/api/sit", { action: "knock", minutes: 45, note: call?.name ? `${call.name}?` : "Come sit with me" });
    setBusy(false);
    if (out?.knock) router.push(`/call/${out.knock.id}`);
  };

  if (!call || editing) {
    return (
      <Editor
        call={call}
        onDone={async (saved) => {
          setEditing(false);
          if (saved) await reload();
        }}
      />
    );
  }
  return (
    <section aria-label="Our weekly call" className="mt-4 rounded-card bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-caption font-semibold uppercase tracking-[0.1em] text-ink-soft">Our weekly call</p>
          <p className="m-0 mt-1 truncate text-title font-semibold leading-tight">{call.name || `${WEEKDAYS[call.weekday]} call`}</p>
        </div>
        {canSet && (
          <button type="button" onClick={() => setEditing(true)} className="press h-11 shrink-0 rounded-full px-3 text-callout font-medium text-ink-soft">
            Change
          </button>
        )}
      </div>
      <p className="tnum m-0 mt-2 text-body" suppressHydrationWarning>
        {callLabel(call, new Date(), viewer.tz, far)}
      </p>
      {host && <p className="m-0 mt-0.5 text-callout text-ink-soft">{host.id === viewer.id ? "You open the call" : `${callName(host)} opens the call`}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href="/api/gather/weekly-call.ics" download="weekly-call.ics" className="press flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-surface px-2 text-callout font-semibold text-ink no-underline">
          <Icon name="calendar" size={17} />
          Add to calendar
        </a>
        <button type="button" onClick={() => void startNow()} disabled={busy} className="press flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-black px-2 text-callout font-semibold text-white disabled:opacity-40">
          <Icon name="video" size={17} />
          Start now
        </button>
      </div>
    </section>
  );
}

function Editor({ call, onDone }: { call: WeeklyCall | null; onDone: (saved: boolean) => void }) {
  const { viewer, members } = useViewer();
  const start = call ? inZone(call, viewer.tz) : { weekday: 0, time: "19:00" };
  const [name, setName] = useState(call?.name ?? "");
  const [weekday, setWeekday] = useState(start.weekday);
  const [time, setTime] = useState(start.time);
  const [hostId, setHostId] = useState(call?.hostId ?? viewer.id);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const hosts = members.filter((m) => m.role !== "child");
  const save = async () => {
    const [hour, minute] = time.split(":").map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return;
    setSaving(true);
    setFailed(false);
    // The weekday and time are what you see on your own clock; the call keeps your zone.
    const out = await postJson("/api/gather/weekly-call", { weekday, hour, minute, tz: viewer.tz === "UTC" ? "Asia/Kolkata" : viewer.tz, hostId, ...(name.trim() ? { name: name.trim() } : {}) }, "PUT");
    setSaving(false);
    if (out) onDone(true);
    else setFailed(true);
  };
  return (
    <section aria-label="Set the weekly call" className="mt-4 rounded-card bg-card p-4 shadow-card">
      <p className="m-0 text-caption font-semibold uppercase tracking-[0.1em] text-ink-soft">Our weekly call</p>
      <p className="m-0 mt-1 text-headline font-semibold leading-snug">{call ? "Change the day and time" : "One hour every week that is always ours."}</p>
      <label className="mt-3 block text-footnote font-medium text-ink-soft">
        Name
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} maxLength={40} placeholder="Sunday chai" className={`${FIELD} mt-1`} />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block text-footnote font-medium text-ink-soft">
          Day
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={`${FIELD} mt-1`}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-footnote font-medium text-ink-soft">
          Time, your clock
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${FIELD} mt-1`} />
        </label>
      </div>
      <label className="mt-3 block text-footnote font-medium text-ink-soft">
        Who opens the call
        <select value={hostId} onChange={(e) => setHostId(e.target.value)} className={`${FIELD} mt-1`}>
          {hosts.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id === viewer.id ? "Me" : callName(m)}
            </option>
          ))}
        </select>
      </label>
      {failed && (
        <p className="m-0 mt-2 text-callout text-[#b3261e]" role="alert">
          Couldn&rsquo;t save. Try again.
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button className="flex-[1.4] !h-11" disabled={saving || !time} onClick={() => void save()}>
          Save
        </Button>
        {call && (
          <Button variant="secondary" className="flex-1 !h-11" onClick={() => onDone(false)}>
            Cancel
          </Button>
        )}
      </div>
    </section>
  );
}
