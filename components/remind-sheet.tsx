"use client";

import { useState } from "react";
import { callName } from "@/lib/people";
import { postJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { BottomSheet } from "./ui/bottom-sheet";
import { Icon } from "./ui/kit";
import { useViewer } from "./viewer";

// "Remind me to ask": a private note to yourself to ask someone how something went. It waits
// in For you on the day you pick; nobody else ever sees it, and nothing is sent to anyone.
// Settings, My reminders, lets you change or delete it.

const WHEN = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "Next week" },
] as const;

export function RemindMe({ aboutId, href, what, tone = "light", className }: { aboutId: string; href: string; what: string; tone?: "light" | "dark"; className?: string }) {
  const { viewer, members } = useViewer();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<1 | 3 | 7>(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  if (!aboutId || aboutId === viewer.id) return null;
  const who = callName(members.find((m) => m.id === aboutId));

  const save = async () => {
    setBusy(true);
    setFailed(false);
    const out = await postJson<{ reminder: { id: string } }>("/api/nudges", { action: "remind", aboutId, href, what: what.slice(0, 80), days, note });
    setBusy(false);
    if (!out?.reminder) return setFailed(true);
    setDone(WHEN.find((w) => w.days === days)?.label ?? "");
    setOpen(false);
    setNote("");
  };

  return (
    <>
      <button
        type="button"
        data-ui="remind-me"
        onClick={() => setOpen(true)}
        className={cn("press flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-callout font-semibold", tone === "dark" ? "bg-white/15 text-white" : "bg-tint text-ink", className)}
      >
        <Icon name="bell" size={16} /> {done ? `I'll remind you · ${done.toLowerCase()}` : "Remind me to ask"}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={`Remind me to ask ${who}`} z={90}>
        <div className="space-y-4">
          <p className="m-0 text-callout leading-snug text-ink-soft">Only you will see this, in For you on the day.</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="When">
            {WHEN.map((w) => (
              <button key={w.days} type="button" role="radio" aria-checked={days === w.days} onClick={() => setDays(w.days)} className={cn("press min-h-[44px] rounded-full text-callout font-semibold", days === w.days ? "bg-accent text-accent-ink" : "bg-tint text-ink")}>
                {w.label}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-footnote font-medium text-ink-soft">A note for yourself (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} placeholder={`How did it go, ${who}?`} className="h-12 w-full rounded-[14px] bg-surface px-3 text-body text-ink" style={{ boxShadow: "var(--surface-edge)" }} />
          </label>
          {failed && (
            <p className="m-0 text-callout text-ink" role="alert">
              That didn&rsquo;t save. Try again?
            </p>
          )}
          <button type="button" onClick={() => void save()} disabled={busy} className="press flex h-12 w-full items-center justify-center rounded-full bg-accent text-body font-semibold text-accent-ink disabled:opacity-60">
            {busy ? "Saving…" : "Remind me"}
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
