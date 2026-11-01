"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { usePlayer } from "@/components/player";
import { useShell } from "@/components/shell";
import { Avatar, EmptyLine, Icon, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import type { InboxItem } from "@/lib/inbox";
import { callName, memberPhoto } from "@/lib/people";
import { useFamilyCards } from "@/lib/use-family";
import { useJson } from "@/lib/use-json";

// For you: what people sent you in the last 30 days. "Waiting for you" first (not played or
// answered yet), then "Earlier". Play a voice note right here; reply by voice in one tap.

function when(iso: string, tz: string): string {
  try {
    const d = new Date(iso);
    const day = new Intl.DateTimeFormat("en", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
    const time = new Intl.DateTimeFormat("en", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
    return `${day}, ${time}`;
  } catch {
    return new Date(iso).toDateString();
  }
}

function Row({ item, tz }: { item: InboxItem; tz: string }) {
  const { members } = useViewer();
  const { openAdd, refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const { play, current, isPlaying, toggle } = usePlayer();
  const from = members.find((m) => m.id === item.fromId);
  const card = item.cardId ? cards?.find((c) => c.id === item.cardId) : undefined;
  const on = Boolean(card && current?.id === card.id);
  const seen = () => {
    if (item.nudgeId) void fetch("/api/nudges/seen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [item.nudgeId] }) }).catch(() => undefined);
  };
  const pill = "press flex h-11 items-center gap-1.5 rounded-full px-4 text-callout font-semibold no-underline";
  return (
    <li data-inbox={item.kind} className="rounded-card bg-card p-3 shadow-card">
      <div className="flex items-center gap-3">
        {from ? (
          <Avatar src={memberPhoto(from)} name={callName(from)} size={44} />
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-well text-ink-soft" aria-hidden="true">
            <Icon name="sparkle" size={18} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="m-0 text-body font-semibold leading-snug">{item.text}</p>
          <p className="m-0 text-footnote text-ink-soft">
            <time dateTime={item.at}>{when(item.at, tz)}</time>
            {item.heard && " · You played it"}
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 ps-[56px]">
        {item.action === "play" && card ? (
          <button type="button" onClick={() => (on ? toggle() : play(card))} className={`${pill} bg-black text-white`} aria-label={`${on && isPlaying ? "Pause" : "Play"}: ${item.text}`}>
            <Icon name={on && isPlaying ? "pause" : "play"} size={15} />
            {on && isPlaying ? "Pause" : "Play"}
          </button>
        ) : (
          <Link href={item.href} onClick={seen} className={`${pill} ${item.waiting ? "bg-black text-white" : "bg-well text-ink"}`}>
            {item.action === "answer" ? "Answer" : "Open"}
          </Link>
        )}
        {item.replyTo && (
          <button type="button" onClick={() => openAdd("voice", null, [item.replyTo as string])} className={`${pill} bg-well text-ink`} aria-label={`Reply by voice to ${callName(from)}`}>
            <Icon name="mic" size={15} />
            Reply by voice
          </button>
        )}
      </div>
    </li>
  );
}

function Section({ title, items, tz }: { title: string; items: InboxItem[]; tz: string }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="mb-6">
      <h2 className="m-0 mb-2 text-headline">{title}</h2>
      <ul className="m-0 list-none space-y-2.5 p-0">
        {items.map((i) => (
          <Row key={i.id} item={i} tz={tz} />
        ))}
      </ul>
    </section>
  );
}

export default function InboxPage() {
  const { viewer } = useViewer();
  const { refreshKey } = useShell();
  const { current, isPlaying } = usePlayer();
  const { data, failed, reload } = useJson<{ items: InboxItem[] }>(`/api/inbox?k=${refreshKey}`);
  // Playing something here marks it heard on the server a moment later: refresh the lists then.
  useEffect(() => {
    if (!current || !isPlaying) return;
    const id = window.setTimeout(() => void reload(), 2500);
    return () => window.clearTimeout(id);
  }, [current, isPlaying, reload]);
  const waiting = useMemo(() => (data?.items ?? []).filter((i) => i.waiting), [data]);
  const earlier = useMemo(() => (data?.items ?? []).filter((i) => !i.waiting), [data]);
  return (
    <div>
      <RoomHeader title="For you" subtitle="What people sent you in the last 30 days" />
      {failed && !data ? (
        <div className="rounded-card bg-card p-4 text-center shadow-card" role="alert">
          <p className="m-0 text-headline font-semibold">Couldn&rsquo;t load what&rsquo;s for you.</p>
          <button type="button" onClick={() => void reload()} className="press mt-3 h-11 rounded-full bg-well px-5 text-callout font-semibold">
            Try again
          </button>
        </div>
      ) : !data ? (
        <div key="loading" className="space-y-2.5" aria-busy="true" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-[104px] rounded-card" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyLine>Nothing waiting. When someone sends you something, it lands here.</EmptyLine>
      ) : (
        <>
          <Section title="Waiting for you" items={waiting} tz={viewer.tz} />
          <Section title="Earlier" items={earlier} tz={viewer.tz} />
          {waiting.length === 0 && <p className="m-0 mb-6 text-body text-ink-soft">Nothing waiting. When someone sends you something, it lands here.</p>}
        </>
      )}
    </div>
  );
}
