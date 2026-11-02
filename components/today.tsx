"use client";

import { useEffect } from "react";
import type { TodayTask } from "@/lib/kinds";
import { callName } from "@/lib/people";
import { useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { useShell } from "./shell";
import { ShareTodayAnswer } from "./share-quote";
import { Icon } from "./ui/kit";
import { useViewer } from "./viewer";
import { PromptText } from "./prompt-text";

type View = TodayTask & { side: "parents" | "children" | null; mine: boolean; theirs: boolean };
export interface TodayData {
  task: View | null;
  recent: View[];
  occasion: { slug: string; title: string; date: string; days: number; memberId: string | null } | null;
}

/** Today's task, refreshed when an answer is sent from the composer. */
export function useToday(): { data: TodayData | null; reload: () => Promise<void> } {
  const { data, reload } = useJson<TodayData>("/api/today");
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener("aangan:today", on);
    return () => window.removeEventListener("aangan:today", on);
  }, [reload]);
  return { data, reload };
}

/** What has happened, in words. Every answer is open to everyone at once: nothing is held back. */
function todayLine(task: View, otherNames: string): string {
  if (task.completedAt) return "Both homes answered. It's in Memories.";
  if (task.mine && !task.theirs) return "Yours is in. It's in Memories.";
  if (task.theirs) return `${otherNames} answered. Listen in Memories, and add yours if you like.`;
  return "Answer whenever you like. Everyone hears every answer.";
}

export function TodayCard({ variant = "card" }: { variant?: "card" | "line" }) {
  const { viewer, members } = useViewer();
  const { openAdd } = useShell();
  const { data } = useToday();
  const task = data?.task;
  if (!task || !task.side) return null;
  const prompt = task.side === "parents" ? task.forParents : task.forChildren;
  const otherIds = task.side === "parents" ? task.children : task.parents;
  const answeredOthers = members.filter((m) => otherIds.includes(m.id) && task.answers.some((a) => a.memberId === m.id));
  const otherNames = (answeredOthers.length ? answeredOthers : members.filter((m) => otherIds.includes(m.id)))
    .slice(0, 2)
    .map((m) => callName(m))
    .join(" & ");
  const answer = () => openAdd("voice", { kind: "today", taskId: task.id, prompt }, otherIds.filter((id) => id !== viewer.id));
  const status = todayLine(task, otherNames || "the other home");
  const myAnswer = task.answers.find((a) => a.memberId === viewer.id);

  if (variant === "line")
    return (
      <button type="button" onClick={task.mine ? undefined : answer} className={cn("glass-dark press flex w-full items-center gap-3 rounded-[22px] px-4 py-3 text-left", task.mine && "cursor-default")}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-black">
          <Icon name={task.mine ? "check" : "mic"} size={18} strokeWidth={2.4} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-caption font-semibold uppercase tracking-[0.08em] text-white/60">Today, both homes</span>
          <span className="voice block truncate text-headline leading-snug"><PromptText text={prompt} /></span>
          <span className="block truncate text-caption text-white/70">{status}</span>
        </span>
      </button>
    );

  return (
    <section data-ui="today-card" aria-label="Today, for both homes" className="relative mt-5 overflow-hidden rounded-[28px] p-4 text-white" style={{ background: "var(--deep)" }}>
      <p className="relative m-0 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-[0.1em] text-white/65">
        <Icon name="sparkle" size={14} /> Today · both homes
      </p>
      <p className="voice relative m-0 mt-3 text-title leading-[1.2]"><PromptText text={prompt} /></p>
      <p className="relative m-0 mt-2 text-callout text-white/75">{status}</p>
      <div className="relative mt-4 flex items-center gap-2">
        {!task.mine ? (
          <button type="button" onClick={answer} className="press flex h-12 items-center gap-2 rounded-full bg-white pl-2 pr-5 text-body font-semibold text-black">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-tint">
              <Icon name="mic" size={18} strokeWidth={2.4} />
            </span>
            Add yours
          </button>
        ) : (
          <span className="flex h-12 items-center gap-2 rounded-full bg-white/10 px-4 text-callout font-semibold">
            <Icon name="check" size={16} /> You answered
          </span>
        )}
        {myAnswer && <ShareTodayAnswer cardId={myAnswer.cardId} className="h-12 w-12" />}
      </div>
    </section>
  );
}
