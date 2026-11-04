"use client";

import { markPushFirstAction } from "@/lib/web-push";
import { useEffect, useState } from "react";
import { ACTIVITIES, DEFAULT_DOOR_MINUTES, DOOR_MINUTES, PRESETS, type Activity } from "@/lib/doors";
import type { Knock } from "@/lib/kinds";
import { MAX_SIT_INVITES } from "@/lib/kind-values";
import { callName, memberPhoto } from "@/lib/people";
import { postJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { BottomSheet } from "./ui/bottom-sheet";
import { Avatar, Icon } from "./ui/kit";
import { useViewer } from "./viewer";

// "Open your door": what for, who may come, for how long. Opening the door only says
// "I have time now, come sit"; it never starts a call or the microphone. Whoever it is
// open to sees it on their window and chooses to join (or not) from there.

export interface DoorPreset {
  activity?: Activity;
  /** One person only: "Can I sit with you?" */
  only?: string;
}

const CHIP = "press flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-callout font-semibold";

export function OpenDoorSheet({ open, preset, onClose, onOpened }: { open: boolean; preset?: DoorPreset; onClose: () => void; onOpened?: (k: Knock) => void }) {
  const { viewer, members } = useViewer();
  const people = members.filter((m) => m.id !== viewer.id && m.status !== "pending");
  const [activity, setActivity] = useState<Activity>("chai");
  const [who, setWho] = useState<string[]>([]);
  const [minutes, setMinutes] = useState<number>(DEFAULT_DOOR_MINUTES);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setActivity(preset?.activity ?? "chai");
    setWho(preset?.only ? [preset.only] : []);
    setMinutes(DEFAULT_DOOR_MINUTES);
    setFailed(false);
    setBusy(false);
  }, [open, preset?.activity, preset?.only]);

  const toggle = (id: string) => setWho((w) => w.includes(id) ? w.filter((x) => x !== id) : w.length < MAX_SIT_INVITES ? [...w, id] : w);
  const only = preset?.only ? people.find((p) => p.id === preset.only) : undefined;

  const submit = async () => {
    setBusy(true);
    setFailed(false);
    const out = await postJson<{ knock: Knock }>("/api/sit", { action: "knock", activity, minutes, note: PRESETS[activity].line, invites: who });
    setBusy(false);
    if (!out?.knock) return setFailed(true);
    markPushFirstAction();
    onOpened?.(out.knock);
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={only ? "Can I sit with you?" : "Open your door"} dataUi="open-door-sheet">
      <div className="space-y-5">
        <p className="m-0 text-callout leading-snug text-ink-soft">
          {only ? `${callName(only)} sees your door is open and can join, or not. Nothing starts until someone chooses to.` : "Say you have time now. Whoever you open it to can join, or not. Nothing starts until someone chooses to."}
        </p>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 p-0 text-footnote font-medium text-ink-soft">What</legend>
          <div className="flex flex-wrap gap-2">
            {ACTIVITIES.map((a) => (
              <button key={a} type="button" aria-pressed={activity === a} onClick={() => setActivity(a)} className={cn(CHIP, activity === a ? "bg-accent text-accent-ink" : "bg-tint text-ink")}>
                <Icon name={PRESETS[a].icon} size={16} /> {PRESETS[a].label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 p-0 text-footnote font-medium text-ink-soft">Who</legend>
          {who.length >= MAX_SIT_INVITES && <p role="status" className="mb-2 text-footnote text-ink-soft">Up to {MAX_SIT_INVITES} people</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={who.length === 0} onClick={() => setWho([])} className={cn(CHIP, who.length === 0 ? "bg-accent text-accent-ink" : "bg-tint text-ink")}>
              Everyone
            </button>
            {people.map((p) => {
              const on = who.includes(p.id);
              return (
                <button key={p.id} type="button" aria-pressed={on} disabled={!on && who.length >= MAX_SIT_INVITES} onClick={() => toggle(p.id)} className={cn(CHIP, "pl-1 disabled:opacity-50", on ? "bg-accent text-accent-ink" : "bg-tint text-ink")}>
                  <Avatar src={memberPhoto(p)} name={callName(p)} size={32} /> {callName(p)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 p-0 text-footnote font-medium text-ink-soft">How long</legend>
          <div className="grid grid-cols-4 gap-2">
            {DOOR_MINUTES.map((n) => (
              <button key={n} type="button" aria-pressed={minutes === n} onClick={() => setMinutes(n)} className={cn(CHIP, "justify-center px-0", minutes === n ? "bg-accent text-accent-ink" : "bg-tint text-ink")}>
                {n} min
              </button>
            ))}
          </div>
        </fieldset>

        {failed && (
          <p className="m-0 text-callout text-ink" role="alert">
            Couldn&rsquo;t open your door. Try again.
          </p>
        )}
        <button type="button" data-ui="open-door" onClick={() => void submit()} disabled={busy} className="press flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-body font-semibold text-accent-ink disabled:opacity-60">
          <Icon name="door" size={19} /> {busy ? "Opening…" : "Open the door"}
        </button>
      </div>
    </BottomSheet>
  );
}
