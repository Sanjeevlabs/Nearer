"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OpenDoorSheet, type DoorPreset } from "@/components/open-door-sheet";
import { Avatar, Icon, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { ACTIVITIES, PRESETS, doorLine, doorsFor } from "@/lib/doors";
import type { Knock } from "@/lib/kinds";
import { callName, memberPhoto } from "@/lib/people";
import { postJson, useJson } from "@/lib/use-json";
import { timeIn } from "@/lib/zones";

// Time together: every way to say "I have time now, come sit". A preset opens the
// "Open your door" sheet (what, who, how long); opening the door never starts a call.
// Above them: your own open door, and the doors open to you (only those you may see:
// GET /api/sit already leaves out doors opened to other people). Story, song and quiz
// are presets for the conversation; there is no game logic behind them.

export default function TimeTogetherPage() {
  const router = useRouter();
  const { viewer, members } = useViewer();
  const sit = useJson<{ knocks: Knock[] }>("/api/sit", { every: 60_000 });
  const [sheet, setSheet] = useState<DoorPreset | null>(null);
  const [closing, setClosing] = useState(false);
  const nameOf = (id: string) => callName(members.find((m) => m.id === id));
  const { doors, myDoor } = doorsFor(sit.data?.knocks ?? [], viewer.id, nameOf, Date.now());
  const until = (iso: string) => timeIn(viewer.tz, new Date(iso));

  const closeDoor = async () => {
    setClosing(true);
    await postJson("/api/sit", { action: "unknock" });
    setClosing(false);
    await sit.reload();
  };

  return (
    <div>
      <RoomHeader title="Time together" subtitle="Say you have time now. Whoever you open it to can join, or not." />

      <div aria-live="polite">
        {!sit.data && !sit.failed && <div className="skeleton mb-3 h-[64px] rounded-card" aria-busy="true" aria-label="Checking open doors" />}
        {!sit.data && sit.failed && (
          <div className="mb-3 flex min-h-[56px] items-center gap-3 rounded-card bg-well p-3 pl-4">
            <p className="m-0 min-w-0 flex-1 text-body text-ink-soft">Couldn&rsquo;t check right now.</p>
            <button type="button" onClick={() => void sit.reload()} className="press flex h-11 items-center rounded-full bg-card px-4 text-body font-semibold">
              Retry
            </button>
          </div>
        )}

        {myDoor && (
          <div data-ui="together-mine" className="mb-3 flex min-h-[56px] items-center gap-3 rounded-card bg-deep p-3 pl-4 text-white shadow-card">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/15" aria-hidden="true">
              <Icon name="door" size={20} />
            </span>
            <span className="min-w-0 flex-1" suppressHydrationWarning>
              <span className="block text-body font-semibold">Your door is open until {until(myDoor.until)}</span>
              <span className="block truncate text-body text-white/75">{doorLine(myDoor)}</span>
            </span>
            <button type="button" onClick={() => void closeDoor()} disabled={closing} className="press flex h-11 shrink-0 items-center rounded-full bg-white px-4 text-body font-semibold text-[#1c1b1a] disabled:opacity-60">
              {closing ? "Closing…" : "Close door"}
            </button>
          </div>
        )}

        {doors.map((d) => {
          const who = members.find((m) => m.id === d.hostId);
          return (
            <div key={d.id} data-ui="together-door" className="mb-3 flex min-h-[56px] items-center gap-3 rounded-card bg-card p-3 pl-4 shadow-card">
              <Avatar src={memberPhoto(who)} name={callName(who)} size={44} />
              <span className="min-w-0 flex-1" suppressHydrationWarning>
                <span className="block text-body font-semibold">{d.hostName}&rsquo;s door is open</span>
                <span className="block truncate text-body text-ink-soft">
                  {doorLine(d)} · until {until(d.until)}
                </span>
              </span>
              <button type="button" onClick={() => router.push(`/call/${encodeURIComponent(d.id)}`)} className="press flex h-11 shrink-0 items-center rounded-full bg-accent px-4 text-body font-semibold text-accent-ink">
                Join
              </button>
            </div>
          );
        })}
      </div>

      <ul className="m-0 grid list-none gap-3 p-0" aria-label="Things to do together">
        {ACTIVITIES.map((a) => (
          <li key={a}>
            <button type="button" onClick={() => setSheet({ activity: a })} className="press flex min-h-[64px] w-full items-center gap-4 rounded-card bg-card p-4 text-left text-ink shadow-card">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-well">
                <Icon name={PRESETS[a].icon} size={22} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1 text-headline font-semibold leading-tight">{PRESETS[a].label}</span>
              <span className="flex h-11 shrink-0 items-center rounded-full bg-deep px-4 text-body font-semibold text-white">Open door</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center gap-3 rounded-card bg-well p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card">
          <Icon name="door" size={19} strokeWidth={1.8} />
        </span>
        <p className="m-0 text-body leading-snug text-ink-soft">Opening your door starts nothing. Whoever joins chooses audio or video first.</p>
      </div>
      <OpenDoorSheet open={sheet !== null} preset={sheet ?? undefined} onClose={() => setSheet(null)} />
    </div>
  );
}
