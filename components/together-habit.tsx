"use client";

import { useState } from "react";
import { DEFAULT_HABIT, HABIT_NAME_MAX, doneLabel, habitLine, habitTitle, timeLabel, type HabitData } from "@/lib/habits";
import { callName, memberPhoto } from "@/lib/people";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { BottomSheet } from "./share-panel";
import { ActionMenu, Avatar, Button, Icon, type MenuAction } from "./ui/kit";
import { useViewer } from "./viewer";

// Together habit: one shared family habit ("Morning walk · 7 AM"). Each person
// who joined ticks it once a day; the family sees one line of words ("Maa and
// Priya walked today"), never a score, a streak or a number of days, and never
// one person set against another. When everyone who joined has done it, their
// faces glow like the lamp. Sits below the Today card in the courtyard; its data
// rides in the courtyard payload (the "habits" slice).

type Sheet = "rename" | "time" | null;
type Opt = { joined?: boolean; ticked?: boolean };

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

function Shell({ children, glow = false, label = "Together habit" }: { children: React.ReactNode; glow?: boolean; label?: string }) {
  return (
    <section id="habit" aria-label={label} className={cn("mt-5 rounded-[26px] bg-card p-5 shadow-card", glow && "ring-1 ring-[#e9b44c]/60")}>
      {children}
    </section>
  );
}

export function TogetherHabit() {
  const { viewer, members } = useViewer();
  const { data, failed, reload } = useJson<HabitData>("/api/habits");
  const [opt, setOpt] = useState<Opt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);

  if (!data) {
    return failed ? (
      <Shell>
        <p className="m-0 text-[15px] text-ink-soft">Couldn&rsquo;t load the walk just now.</p>
        <Button variant="secondary" className="mt-3 !h-11" onClick={() => void reload()}>
          Try again
        </Button>
      </Shell>
    ) : (
      <div className="skeleton mt-5 h-[184px] rounded-[26px]" aria-busy="true" aria-label="Loading" />
    );
  }

  const run = async (body: Record<string, unknown>, optimistic?: Opt): Promise<boolean> => {
    setBusy(true);
    setError(false);
    if (optimistic) setOpt(optimistic);
    const out = await postJson("/api/habits", body);
    if (out) await reload();
    setOpt(null);
    setBusy(false);
    setError(!out);
    return Boolean(out);
  };

  // Nobody has started one yet: a grown-up can, with one tap. Children see nothing here.
  if (!data.habit) {
    if (!data.can.create) return null;
    return (
      <Shell>
        <p className="m-0 flex items-center gap-2 text-[17px] font-semibold">
          <Icon name="walk" size={19} /> Walk together in the mornings
        </p>
        <p className="m-0 mt-1 text-[14.5px] text-ink-soft">One shared habit. Each of you ticks it when you&rsquo;ve done yours, and the family sees it in words.</p>
        <Button className="mt-4 w-full" disabled={busy} onClick={() => void run({ action: "create", ...DEFAULT_HABIT })}>
          {busy ? "Starting…" : `Start “${DEFAULT_HABIT.name}” · ${timeLabel(DEFAULT_HABIT.hour, DEFAULT_HABIT.minute)}`}
        </Button>
        {error && (
          <p role="alert" className="m-0 mt-2 text-[13.5px] text-[#b42318]">
            Couldn&rsquo;t start it just now. Try again.
          </p>
        )}
      </Shell>
    );
  }

  const habit = data.habit;
  const me = { ...data.me, ...opt };
  const mine = viewer.id;
  // Who is in, with the word the viewer uses for each. Those who have done it today first, in the order they did.
  const doneOrder = data.today.map((t) => t.memberId);
  const inIds = habit.members.filter((id) => id !== mine || me.joined);
  const withViewer = me.joined && !inIds.includes(mine) ? [...inIds, mine] : inIds;
  const ids = [...doneOrder.filter((id) => withViewer.includes(id)), ...withViewer.filter((id) => !doneOrder.includes(id))];
  const joined = ids.flatMap((id) => {
    const m = id === mine ? viewer : members.find((x) => x.id === id);
    return m ? [{ id, name: callName(m), member: m }] : [];
  });
  const tickedIds = [...doneOrder.filter((id) => id !== mine), ...(me.ticked ? [mine] : [])].filter((id) => joined.some((j) => j.id === id));
  const line = habitLine({ habitName: habit.name, viewerId: mine, joined, tickedIds });
  const everyone = joined.length >= 2 && joined.every((j) => tickedIds.includes(j.id));

  const actions: MenuAction[] = [];
  if (data.can.edit) actions.push({ label: "Rename", onSelect: () => setSheet("rename") }, { label: "Change time", onSelect: () => setSheet("time") });
  if (me.joined) actions.push({ label: "Leave", onSelect: async () => void (await run({ action: "leave", habitId: habit.id })) });
  if (data.can.archive) actions.push({ label: "Archive", danger: true, confirm: `Archive “${habit.name}” for everyone?`, onSelect: async () => void (await run({ action: "archive", habitId: habit.id })) });

  const press = () => {
    if (busy) return;
    if (!me.joined) return void run({ action: "join", habitId: habit.id }, { joined: true });
    return void run({ action: me.ticked ? "untick" : "tick", habitId: habit.id }, { ticked: !me.ticked });
  };
  const label = !me.joined ? "I'm in" : me.ticked ? doneLabel(habit.name) : "Done today";

  return (
    <Shell glow={everyone}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
            <Icon name="walk" size={14} /> Together
          </p>
          <h2 className="m-0 mt-1 text-[19px] font-semibold leading-tight">{habitTitle(habit)}</h2>
        </div>
        <ActionMenu actions={actions} label="Habit options" className="-mr-2 -mt-1.5" />
      </div>

      {joined.length > 0 && (
        <ul className="m-0 mt-3 flex list-none items-center p-0" aria-label="Who is in">
          {joined.map((j, i) => (
            <li key={j.id} className={cn("rounded-full", i > 0 && "-ml-2", everyone && "kutumb-lamp")} title={j.name} style={{ position: "relative", zIndex: joined.length - i }}>
              <Avatar src={memberPhoto(j.member)} name={j.name} size={38} ring />
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={press}
        disabled={busy}
        aria-pressed={me.joined ? me.ticked : undefined}
        aria-busy={busy}
        className={cn(
          "press mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full text-[17px] font-semibold disabled:opacity-70",
          me.joined && me.ticked ? "bg-surface text-ink ring-1 ring-black/10" : "bg-black text-white",
        )}
      >
        {label}
      </button>
      <p className="m-0 mt-3 text-center text-[15px] text-ink-soft" aria-live="polite">
        {line}
      </p>
      {error && (
        <p role="alert" className="m-0 mt-1 text-center text-[13.5px] text-[#b42318]">
          Couldn&rsquo;t save just now. Tap to try again.
        </p>
      )}

      {sheet && <EditSheet kind={sheet} habit={habit} onClose={() => setSheet(null)} onSave={(b) => run({ habitId: habit.id, ...b })} />}
    </Shell>
  );
}

/** Rename or change the time: nothing saves until Save (the Settings rule). */
function EditSheet({ kind, habit, onClose, onSave }: { kind: "rename" | "time"; habit: NonNullable<HabitData["habit"]>; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState(habit.name);
  const [time, setTime] = useState(hhmm(habit.hour, habit.minute));
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const trimmed = name.trim();
  const valid = kind === "rename" ? trimmed.length > 0 && trimmed !== habit.name : /^\d{2}:\d{2}$/.test(time) && time !== hhmm(habit.hour, habit.minute);
  const save = async () => {
    setState("saving");
    const [h, m] = time.split(":").map(Number);
    const ok = await onSave(kind === "rename" ? { action: "rename", name: trimmed } : { action: "retime", hour: h, minute: m });
    if (ok) onClose();
    else setState("failed");
  };
  return (
    <BottomSheet open onClose={onClose} label={kind === "rename" ? "Rename the habit" : "Change the time"}>
      <p className="m-0 text-[21px] font-semibold">{kind === "rename" ? "Rename" : "Change the time"}</p>
      <p className="m-0 mt-1 text-[14.5px] text-ink-soft">{kind === "rename" ? "Everyone in the family sees the new name." : "Each person's own morning: 7 AM is 7 AM wherever they are."}</p>
      {kind === "rename" ? (
        <label className="mt-4 block">
          <span className="sr-only">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={HABIT_NAME_MAX} className="h-12 w-full rounded-[16px] bg-surface px-4 text-[16px] text-ink" />
        </label>
      ) : (
        <label className="mt-4 block">
          <span className="sr-only">Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-12 w-full rounded-[16px] bg-surface px-4 text-[16px] text-ink" />
        </label>
      )}
      {state === "failed" && (
        <p role="alert" className="m-0 mt-2 text-[13.5px] text-[#b42318]">
          Couldn&rsquo;t save. Try again.
        </p>
      )}
      <Button className="mt-4 w-full" disabled={!valid || state === "saving"} onClick={() => void save()}>
        {state === "saving" ? "Saving…" : state === "failed" ? "Retry" : "Save"}
      </Button>
      <button type="button" onClick={onClose} className="press mt-1 h-11 w-full rounded-full text-[15px] font-semibold text-ink-soft">
        Discard
      </button>
    </BottomSheet>
  );
}
