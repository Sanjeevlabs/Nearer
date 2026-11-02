"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, use } from "react";
import { AvailabilityPicker } from "@/components/event-availability";
import { AvatarStack, comingIds, EventTimes, JoinButton } from "@/components/event-card";
import { EventSections } from "@/components/event-sections";
import { ActionMenu, Button, Icon, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { icsFor } from "@/lib/overlap";
import { isLive, lockedStart, participants, startsInLabel, type FamilyEvent } from "@/lib/events";
import { eventAction, useEvents } from "@/lib/gather-client";
import { callName } from "@/lib/people";
import { Boundary } from "@/components/ui/boundary";

type Tab = "plan" | "tasks" | "playlist";

export default function EventPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { viewer, members } = useViewer();
  const router = useRouter();
  const { data, failed, reload } = useEvents();
  const [local, setLocal] = useState<FamilyEvent | null>(null);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("plan");
  useEffect(() => {
    setMounted(true);
    const q = new URLSearchParams(window.location.search).get("tab");
    if (q === "tasks" || q === "playlist") setTab(q);
    const t = setInterval(() => void reload(), 30_000);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => setLocal(null), [data]);

  const e = local ?? data?.events.find((x) => x.id === params.id) ?? null;
  // The calendar link opens our own call page (its pre-join asks before any microphone or camera), never a public room.

  if (!mounted || (!data && !failed)) {
    return (
      <div aria-busy="true" aria-label="Loading">
        <RoomHeader title="Celebration" />
        <div className="skeleton h-[150px] rounded-[28px]" />
        <div className="skeleton mt-4 h-10 rounded-full" />
        <div className="skeleton mt-4 h-[260px] rounded-[22px]" />
      </div>
    );
  }
  if (!e) {
    return (
      <div>
        <RoomHeader title="Celebration" />
        <div className="rounded-[28px] bg-tint p-4" role={failed ? "alert" : undefined}>
          <p className="m-0 text-headline font-semibold">{failed ? "Couldn't load this celebration." : "This celebration has ended or was cancelled."}</p>
          <div className="mt-3 flex gap-2">
            {failed && (
              <Button variant="secondary" className="!bg-surface" onClick={() => void reload()}>
                Try again
              </Button>
            )}
            <Link href="/gather" className="press flex h-12 items-center rounded-full px-5 text-body font-semibold text-ink no-underline">
              All celebrations
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const start = lockedStart(e);
  const live = isLive(e);
  const isHost = e.hostId === viewer.id;
  const invited = participants(e).includes(viewer.id);
  const host = members.find((m) => m.id === e.hostId);
  const actions = [
    ...(start
      ? [
          {
            label: "Add to calendar",
            onSelect: () => {
              const blob = new Blob([icsFor({ id: e.id, title: e.title, start, minutes: e.minutes, description: e.plan.runOfShow.map((s) => s.title).join(" · "), url: e.sittingId ? `${window.location.origin}/call/${encodeURIComponent(e.sittingId)}` : undefined })], { type: "text/calendar" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `${e.title.replace(/[^\w]+/g, "-").toLowerCase()}.ics`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            },
          },
        ]
      : []),
    ...(isHost
      ? [
          {
            label: "Cancel the celebration",
            danger: true,
            confirm: "Cancel it for everyone?",
            onSelect: async () => {
              await eventAction({ action: "cancel", eventId: e.id });
              router.push("/gather");
            },
          },
        ]
      : []),
  ];

  return (
    <div>
      <RoomHeader title={e.title} subtitle={`Set up by ${callName(host)}`} action={actions.length ? <ActionMenu actions={actions} /> : undefined} />

      {start ? (
        <section className="relative overflow-hidden rounded-[28px] p-4 text-white" style={{ background: "var(--deep)" }} aria-label="When">
          <p className="m-0 text-caption font-semibold uppercase tracking-[0.08em] text-white/55">{live ? "Live now" : startsInLabel(start)}</p>
          <div className="mt-2">
            <EventTimes at={start} members={members} viewer={viewer} ids={participants(e)} tone="dark" />
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <AvatarStack ids={comingIds(e)} members={members} tone="dark" />
            {live ? <JoinButton e={e} /> : <span className="flex items-center gap-1.5 text-footnote text-white/60"><Icon name="video" size={16} />Room opens 15 min before</span>}
          </div>
        </section>
      ) : invited ? (
        <section aria-label="Pick a time">
          <p className="m-0 mb-2 text-caption font-semibold uppercase tracking-[0.08em] text-ink-faint">Which times work for you?</p>
          <AvailabilityPicker e={e} members={members} viewer={viewer} onChange={(next) => setLocal(next)} />
        </section>
      ) : null}

      <Boundary label="This celebration"><EventSections key={`${e.id}-${tab}`} e={e} members={members} viewer={viewer} initial={tab} onChange={(next) => setLocal(next)} /></Boundary>
    </div>
  );
}
