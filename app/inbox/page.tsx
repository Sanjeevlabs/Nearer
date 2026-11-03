"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePlayer } from "@/components/player";
import { VoiceCard } from "@/components/voice-card";
import { useShell } from "@/components/shell";
import { PushAsk } from "@/components/push-ask";
import { Avatar, EmptyLine, Icon, RoomHeader, type IconName } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import type { InboxItem } from "@/lib/inbox";
import type { SentItem } from "@/lib/sent";
import { cn } from "@/lib/utils";
import { callName, memberPhoto } from "@/lib/people";
import { LoadFailed } from "@/components/load-failed";
import { useFamilyCards } from "@/lib/use-family";
import { useJson } from "@/lib/use-json";

// For you: what people sent you in the last 30 days. "Waiting for you" holds only what needs
// my action; receipts, lamps and occasions are plain lines under "Earlier". Play a voice note
// right here; reply by voice in one tap.

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

const BADGE: Record<InboxItem["badge"], { icon: IconName; label: string }> = {
  voice: { icon: "mic", label: "Voice memory" },
  question: { icon: "question", label: "Question" },
  blessing: { icon: "flower", label: "Blessing" },
  lamp: { icon: "lamp", label: "Lamp" },
  occasion: { icon: "calendar", label: "Occasion" },
  heart: { icon: "heart", label: "Love" },
  today: { icon: "sun", label: "Today" },
};

/** The sender's face (or Monogram) with a small mark for what kind of thing this is. */
function Who({ item }: { item: InboxItem }) {
  const { members } = useViewer();
  const from = members.find((m) => m.id === item.fromId);
  const badge = BADGE[item.badge];
  return (
    <span className="relative inline-block h-11 w-11 shrink-0" data-badge={item.badge} title={badge.label}>
      {from ? (
        <Avatar src={memberPhoto(from)} name={callName(from)} size={44} />
      ) : (
        <span className="grid h-11 w-11 place-items-center rounded-full bg-well text-ink-soft" aria-hidden="true">
          <Icon name={badge.icon} size={18} />
        </span>
      )}
      {from && (
        <span className="absolute -bottom-1 -end-1 grid h-5 w-5 place-items-center rounded-full bg-ink text-card ring-2 ring-[var(--card)]" aria-hidden="true">
          <Icon name={badge.icon} size={11} strokeWidth={2.5} />
        </span>
      )}
    </span>
  );
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
  // A kid's question waiting for you: the answer is by voice, right here (it also lands in Stories). The house screen only points here.
  const kidAsk = item.kind === "kid" && item.waiting && item.id.startsWith("kid-");
  const reply = item.replyTo && !kidAsk ? (
    <button type="button" onClick={() => openAdd("voice", null, [item.replyTo as string])} className="press flex h-11 items-center gap-1.5 rounded-full bg-well px-4 text-callout font-semibold text-ink" aria-label={`Reply by voice to ${callName(from)}`}>
      <Icon name="mic" size={15} />
      Reply by voice
    </button>
  ) : null;
  const meta = (
    <p className="m-0 text-footnote text-ink-soft">
      <time dateTime={item.at}>{when(item.at, tz)}</time>
      {item.heard && " · You played it"}
    </p>
  );

  // Receipts, lamps, reminders and occasions: one plain line. Tapping it opens; a small mic replies.
  if (item.plain) {
    return (
      <li data-inbox={item.kind} data-plain="true" className="flex min-h-14 items-center gap-1 rounded-card bg-card ps-3 pe-1 shadow-card">
        <Link href={item.href} onClick={seen} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 text-ink no-underline">
          <Who item={item} />
          <span className="min-w-0 flex-1">
            <span className="block text-callout leading-snug">{item.text}</span>
            {meta}
          </span>
        </Link>
        {item.replyTo && (
          <button type="button" onClick={() => openAdd("voice", null, [item.replyTo as string])} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-soft" aria-label={`Reply by voice to ${callName(from)}`}>
            <Icon name="mic" size={18} />
          </button>
        )}
      </li>
    );
  }

  const pill = "press flex h-11 items-center gap-1.5 rounded-full px-4 text-callout font-semibold no-underline";
  // A voice for you plays like a song, right in the row.
  const voice = item.action === "play" && card?.type === "audio" ? card : null;
  return (
    <li data-inbox={item.kind} className="rounded-card bg-card p-3 shadow-card">
      <div className="flex items-center gap-3">
        <Who item={item} />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-body font-semibold leading-snug">{item.text}</p>
          {/* "How to listen": a wish from the sender, shown only to the people it was sent to. */}
          {item.listen && (
            <p data-ui="listen-label" className="m-0 text-footnote text-ink-soft">
              {item.listen}
            </p>
          )}
          {meta}
        </div>
      </div>
      {voice && <VoiceCard card={voice} variant="row" className="mt-3" />}
      <div className="mt-2.5 flex flex-wrap items-center gap-2 ps-[56px]">
        {voice ? null : item.action === "play" && card ? (
          <button type="button" onClick={() => (on ? toggle() : play(card))} className={`${pill} ${item.waiting ? "bg-accent text-accent-ink" : "bg-well text-ink"}`} aria-label={`${on && isPlaying ? "Pause" : "Play"}: ${item.text}`}>
            <Icon name={on && isPlaying ? "pause" : "play"} size={15} />
            {on && isPlaying ? "Pause" : "Play"}
          </button>
        ) : kidAsk ? (
          <>
            <button type="button" onClick={() => openAdd("voice", { kind: "kid_answer", askId: item.id.slice(4) }, [item.fromId as string])} className={`${pill} bg-accent text-accent-ink`}>
              <Icon name="mic" size={15} />
              Answer by voice
            </button>
            {item.cardId && (
              <Link href={item.href} onClick={seen} className={`${pill} bg-well text-ink`}>
                Listen
              </Link>
            )}
          </>
        ) : (
          <Link href={item.href} onClick={seen} className={`${pill} ${item.waiting ? "bg-accent text-accent-ink" : "bg-well text-ink"}`}>
            {item.action === "answer" ? "Answer" : "Open"}
          </Link>
        )}
        {reply}
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

/** What you sent to particular people, each with where it stands. Nothing you send is out of sight. */
function SentList({ tz }: { tz: string }) {
  const { refreshKey } = useShell();
  const { data, failed, reload } = useJson<{ items: SentItem[] }>(`/api/inbox/sent?k=${refreshKey}`);
  const { members } = useViewer();
  if (failed && !data) return <LoadFailed what="What you sent" ui="sent-retry" onRetry={() => void reload()} />;
  if (!data) {
    return (
      <div key="loading" className="space-y-2.5" aria-busy="true" aria-label="Loading">
        {[0, 1].map((i) => (
          <div key={i} className="skeleton h-[88px] rounded-card" />
        ))}
      </div>
    );
  }
  if (data.items.length === 0) return <EmptyLine>Nothing sent yet. A voice memory you send to someone shows here, with where it stands.</EmptyLine>;
  return (
    <ul data-ui="sent-list" className="m-0 list-none space-y-2.5 p-0">
      {data.items.map((it) => {
        const first = members.find((m) => m.id === it.toIds[0]);
        return (
          <li key={it.id} data-sent={it.status} className="rounded-card bg-card p-3 shadow-card">
            <Link href={it.href} className="flex items-center gap-3 text-ink no-underline">
              <span className="relative inline-block h-11 w-11 shrink-0">
                {first ? <Avatar src={memberPhoto(first)} name={callName(first)} size={44} /> : <span className="grid h-11 w-11 place-items-center rounded-full bg-well text-ink-soft" aria-hidden="true"><Icon name="mic" size={18} /></span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold leading-snug">
                  {it.type === "audio" ? "Voice memory" : it.type === "video" ? "Video" : "Photo"} to {it.to.join(" and ")}
                </span>
                {it.text && <span className="block truncate text-footnote text-ink-soft">{it.text}</span>}
                <span data-ui="sent-status" className={cn("block text-footnote", it.status === "waiting" ? "font-semibold text-ink" : "text-ink-soft")}>
                  {it.line}
                </span>
                <time dateTime={it.at} className="block text-footnote text-ink-soft">
                  {when(it.at, tz)}
                </time>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function InboxPage() {
  const { viewer } = useViewer();
  const [box, setBox] = useState<"for-you" | "sent">("for-you");
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
      <RoomHeader title={box === "sent" ? "Sent" : "For you"} subtitle={box === "sent" ? "What you sent in the last 30 days" : "What people sent you in the last 30 days"} />
      <div role="tablist" aria-label="For you or Sent" data-ui="inbox-tabs" className="mb-5 grid grid-cols-2 gap-1 rounded-full bg-well p-1">
        {(["for-you", "sent"] as const).map((b) => (
          <button key={b} type="button" role="tab" aria-selected={box === b} onClick={() => setBox(b)} className={cn("press h-11 rounded-full text-callout font-semibold", box === b ? "bg-card text-ink shadow-card" : "text-ink-soft")}>
            {b === "sent" ? "Sent" : "For you"}
          </button>
        ))}
      </div>
      {box === "sent" ? (
        <SentList tz={viewer.tz} />
      ) : (
        <>
      <PushAsk className="mb-6" />
      {failed && !data ? (
        <LoadFailed what="Things for you" ui="inbox-retry" onRetry={() => void reload()} />
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
        </>
      )}
    </div>
  );
}
