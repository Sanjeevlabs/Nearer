"use client";

import { useState } from "react";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { Icon } from "../ui/kit";
import { useViewer } from "../viewer";
import { Group } from "./section";

// My reminders: every "Remind me to ask" you set, only ever yours. Change the day or the
// note, or let it go. Nothing here is sent to anyone.

type Reminder = { id: string; text: string; note: string; at: string; seen: boolean };
const DAYS = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "Next week" },
] as const;

export function RemindersSection() {
  const { viewer } = useViewer();
  const { data, failed, reload } = useJson<{ reminders: Reminder[] }>("/api/nudges?reminders=1");
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const day = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: viewer.tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
    } catch {
      return iso.slice(0, 10);
    }
  };
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    await postJson("/api/nudges", body);
    setBusy(false);
    setEditing(null);
    await reload();
  };
  const list = data?.reminders ?? [];

  return (
    <Group title="My reminders" id="reminders">
      <p className="m-0 mb-3 text-callout text-ink-soft">Things you wanted to ask someone. Only you see these.</p>
      {!data && !failed && <div className="skeleton h-[56px] rounded-card" aria-busy="true" aria-label="Loading your reminders" />}
      {!data && failed && (
        <button type="button" onClick={() => void reload()} className="press flex min-h-[44px] items-center rounded-full bg-tint px-4 text-callout font-semibold">
          Couldn&rsquo;t load them. Try again
        </button>
      )}
      {data && list.length === 0 && <p className="m-0 text-callout text-ink-soft">None yet. On a voice note or an event from someone, tap &ldquo;Remind me to ask&rdquo;.</p>}
      <ul className="m-0 list-none space-y-2 p-0">
        {list.map((r) => (
          <li key={r.id} className="rounded-card bg-surface p-3" style={{ boxShadow: "var(--surface-edge)" }}>
            <p className="m-0 text-body font-medium leading-snug">{r.text}</p>
            <p className="m-0 mt-0.5 text-footnote text-ink-soft" suppressHydrationWarning>
              {day(r.at)}
            </p>
            {editing === r.id ? (
              <div className="mt-2 space-y-2">
                <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} className="h-11 w-full rounded-[12px] bg-paper px-3 text-body" />
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d) => (
                    <button key={d.days} type="button" disabled={busy} onClick={() => void act({ action: "edit", id: r.id, days: d.days, note })} className="press min-h-[44px] rounded-full bg-tint px-3 text-footnote font-semibold">
                      {d.label}
                    </button>
                  ))}
                  <button type="button" disabled={busy} onClick={() => void act({ action: "edit", id: r.id, note })} className="press min-h-[44px] rounded-full bg-accent px-4 text-footnote font-semibold text-accent-ink">
                    Save note
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(r.id);
                    setNote(r.note);
                  }}
                  className="press flex min-h-[44px] items-center gap-1 rounded-full bg-tint px-4 text-footnote font-semibold"
                >
                  <Icon name="edit" size={14} /> Change
                </button>
                <button type="button" disabled={busy} onClick={() => void act({ action: "delete", id: r.id })} className={cn("press flex min-h-[44px] items-center gap-1 rounded-full px-4 text-footnote font-semibold text-ink-soft")}>
                  <Icon name="trash" size={14} /> Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Group>
  );
}
