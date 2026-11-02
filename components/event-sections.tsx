"use client";

import { useEffect, useRef, useState } from "react";
import { songLinks, type FamilyEvent } from "@/lib/events";
import { eventAction } from "@/lib/gather-client";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { Avatar, Icon } from "./ui/kit";

const TABS = [
  { id: "plan", label: "Plan" },
  { id: "tasks", label: "Tasks" },
  { id: "playlist", label: "Playlist" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Plan / Tasks / Playlist as swipe sections with a segmented control on top. */
export function EventSections({ e, members, viewer, onChange, initial = "plan" }: { e: FamilyEvent; members: Member[]; viewer: Member; onChange: (next: FamilyEvent) => void; initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
      setTab(TABS[Math.min(TABS.length - 1, Math.max(0, i))].id);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  // The row is as tall as the section on screen, not the tallest one.
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    const panel = el?.children[TABS.findIndex((t) => t.id === tab)] as HTMLElement | undefined;
    if (!panel) return;
    const measure = () => setHeight((panel.firstElementChild as HTMLElement | null)?.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    if (panel.firstElementChild) ro.observe(panel.firstElementChild);
    return () => ro.disconnect();
  }, [tab, e]);
  useEffect(() => {
    // Jump straight to a section (deep links) without animating, once laid out.
    const i = TABS.findIndex((t) => t.id === initial);
    if (i <= 0) return;
    const raf = requestAnimationFrame(() => {
      const el = ref.current;
      const child = el?.children[i] as HTMLElement | undefined;
      if (el && child) el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: "instant" as ScrollBehavior });
    });
    return () => cancelAnimationFrame(raf);
  }, [initial]);
  const go = (t: Tab) => {
    const el = ref.current;
    const i = TABS.findIndex((x) => x.id === t);
    setTab(t);
    const child = el?.children[i] as HTMLElement | undefined;
    if (el && child) el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: "smooth" });
  };
  const total = e.plan.runOfShow.reduce((n, s) => n + s.minutes, 0);
  const done = e.plan.tasks.filter((t) => t.done).length;
  return (
    <section aria-label="Plan, tasks and playlist" className="mt-6">
      <div role="tablist" aria-label="Sections" className="flex rounded-full bg-tint p-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)} className={cn("press h-9 flex-1 rounded-full text-callout font-semibold transition-colors", tab === t.id ? "bg-white text-ink shadow-[0_1px_4px_rgba(0,0,0,.08)]" : "text-ink-soft")}>
            {t.label}
            {t.id === "tasks" && <span className="tnum ml-1 text-caption font-medium text-ink-faint">{done}/{e.plan.tasks.length}</span>}
          </button>
        ))}
      </div>
      <div ref={ref} className="no-scrollbar -mx-4 mt-4 flex items-start overflow-x-auto overflow-y-hidden transition-[height] duration-200" style={{ scrollSnapType: "x mandatory", height }}>
        <div className="w-full shrink-0 px-4" style={{ scrollSnapAlign: "start" }} role="tabpanel" aria-label="Plan">
          <RunOfShow e={e} members={members} total={total} />
        </div>
        <div className="w-full shrink-0 px-4" style={{ scrollSnapAlign: "start" }} role="tabpanel" aria-label="Tasks">
          <Tasks e={e} members={members} viewer={viewer} onChange={onChange} />
        </div>
        <div className="w-full shrink-0 px-4" style={{ scrollSnapAlign: "start" }} role="tabpanel" aria-label="Playlist">
          <Playlist e={e} />
        </div>
      </div>
    </section>
  );
}

function RunOfShow({ e, members, total }: { e: FamilyEvent; members: Member[]; total: number }) {
  let at = 0;
  return (
    <div>
      <p className="tnum m-0 mb-2 text-caption font-semibold uppercase tracking-[0.08em] text-ink-faint">{total} min</p>
      <ol className="m-0 list-none p-0">
        {e.plan.runOfShow.map((s, i) => {
          const from = at;
          at += s.minutes;
          const owner = members.find((m) => m.id === s.ownerId);
          return (
            <li key={s.id} className="relative flex gap-3 pb-4">
              {i < e.plan.runOfShow.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[19px] top-10 w-px bg-tint" />}
              <span className="tnum grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tint text-caption font-semibold text-ink-soft">{from}′</span>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="m-0 text-body font-semibold leading-snug">{s.title}</p>
                  {owner ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-caption text-ink-soft">
                      <Avatar src={memberPhoto(owner)} name={callName(owner)} size={22} />
                      {callName(owner)}
                    </span>
                  ) : (
                    <span className="shrink-0 text-caption text-ink-faint">Everyone</span>
                  )}
                </div>
                {s.note && <p className="voice m-0 mt-0.5 text-body text-ink-soft">{s.note}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Tasks({ e, members, viewer, onChange }: { e: FamilyEvent; members: Member[]; viewer: Member; onChange: (next: FamilyEvent) => void }) {
  const [assigning, setAssigning] = useState<string | null>(null);
  const update = async (taskId: string, patch: { ownerId?: string | null; done?: boolean }) => {
    const out = await eventAction({ action: "task", eventId: e.id, taskId, ...patch });
    if (out?.event) onChange(out.event);
  };
  return (
    <ul className="m-0 list-none space-y-2 p-0">
      {e.plan.tasks.map((t) => {
        const owner = members.find((m) => m.id === t.ownerId);
        return (
          <li key={t.id} className="rounded-[20px] bg-tint p-2">
            <div className="flex items-center gap-2">
              <button type="button" aria-label={t.done ? `Mark "${t.text}" not done` : `Mark "${t.text}" done`} aria-pressed={t.done} onClick={() => void update(t.id, { done: !t.done })} className={cn("press grid h-10 w-10 shrink-0 place-items-center rounded-full border", t.done ? "border-[#1c1b1a] bg-[#1c1b1a] text-white" : "border-black/20 bg-white")}>
                {t.done && <Icon name="check" size={18} strokeWidth={2.5} />}
              </button>
              <p className={cn("m-0 min-w-0 flex-1 text-body leading-snug", t.done && "text-ink-faint line-through")}>{t.text}</p>
              <button type="button" onClick={() => setAssigning(assigning === t.id ? null : t.id)} aria-label={owner ? `${callName(owner)} is doing this. Change` : "Assign someone"} aria-expanded={assigning === t.id} className="press flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white pl-1 pr-3 text-footnote font-semibold">
                {owner ? <Avatar src={memberPhoto(owner)} name={callName(owner)} size={32} /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-tint"><Icon name="assign" size={16} /></span>}
                {owner ? (owner.id === viewer.id ? "You" : callName(owner)) : "Who?"}
              </button>
            </div>
            {assigning === t.id && (
              <div className="no-scrollbar -mx-2 mt-2 flex gap-2 overflow-x-auto px-2 pb-1" role="radiogroup" aria-label="Who does this">
                {members.map((m) => (
                  <button key={m.id} type="button" role="radio" aria-checked={m.id === t.ownerId} onClick={() => { setAssigning(null); void update(t.id, { ownerId: m.id }); }} className={cn("press flex shrink-0 flex-col items-center gap-1 rounded-[14px] p-1.5 text-caption font-semibold", m.id === t.ownerId ? "bg-[#1c1b1a] text-white" : "")}>
                    <Avatar src={memberPhoto(m)} name={callName(m)} size={40} />
                    {m.id === viewer.id ? "You" : callName(m)}
                  </button>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Playlist({ e }: { e: FamilyEvent }) {
  return (
    <div>
      <ol className="m-0 list-none p-0">
        {e.plan.playlist.map((s, i) => {
          const links = songLinks(s);
          return (
            <li key={`${s.title}-${s.artist}`} className="flex items-center gap-3 border-b border-[var(--line)] py-3 last:border-0">
              <span className="tnum w-5 shrink-0 text-center text-footnote font-semibold text-ink-faint">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-body font-semibold">{s.title}</p>
                <p className="m-0 truncate text-footnote text-ink-soft">{s.artist}</p>
                <p className="voice m-0 mt-0.5 text-callout text-ink-soft">{s.why}</p>
              </div>
              <a href={links.youtube} target="_blank" rel="noreferrer" aria-label={`Find ${s.title} on YouTube Music`} className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tint text-ink no-underline">
                <Icon name="play" size={16} />
              </a>
              <a href={links.spotify} target="_blank" rel="noreferrer" aria-label={`Find ${s.title} on Spotify`} className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tint text-ink no-underline">
                <Icon name="music" size={16} />
              </a>
            </li>
          );
        })}
      </ol>
      <p className="m-0 mt-2 text-caption text-ink-faint">Opens a search on YouTube Music or Spotify.</p>
    </div>
  );
}
