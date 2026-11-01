"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Carousel } from "@/components/carousel";
import { EventHero, EventMini } from "@/components/event-card";
import { PlanSheet, type PlanPreset } from "@/components/event-plan-sheet";
import { EventPrompts } from "@/components/event-prompts";
import Link from "next/link";
import { WeeklyCallCard } from "@/components/weekly-call-card";
import { WishAhead } from "@/components/wish-ahead";
import { Avatar, Button, EmptyState, Icon, RoomHeader, SectionTitle } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { occasionEventKey } from "@/lib/events";
import { nextEvent, useEvents } from "@/lib/gather-client";
import type { UpcomingOccasion } from "@/lib/gather-prompts";
import type { Recipe } from "@/lib/kinds";
import { useNextVisit } from "@/components/home-presence";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { useJson } from "@/lib/use-json";
import { Boundary } from "@/components/ui/boundary";

export default function GatherPage() {
  const { viewer, members } = useViewer();
  const router = useRouter();
  const { data, failed, reload } = useEvents();
  // Visits are planned on the Visits tab; here, only a pointer to the next one.
  const visit = useNextVisit();
  const [sheet, setSheet] = useState<PlanPreset | null>(null);
  // Render times after mount so server and browser never disagree on "now".
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const t = setInterval(() => void reload(), 60_000);
    return () => clearInterval(t);
  }, [reload]);

  // Deep links: /gather?plan=1, and from a recipe /gather?reason=cook&recipe=<id>.
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const kitchen = useJson<{ recipes: Recipe[] }>(recipeId ? "/api/kitchen" : null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("reason") === "cook" && q.get("recipe")) setRecipeId(q.get("recipe"));
    else if (q.get("plan")) setSheet({});
  }, []);
  useEffect(() => {
    const r = kitchen.data?.recipes.find((x) => x.id === recipeId);
    if (r) setSheet({ type: "custom", title: `Cook ${r.title} together`.slice(0, 80) });
  }, [kitchen.data, recipeId]);

  const canPlan = data?.canPlan ?? viewer.role !== "child";
  const plus = canPlan ? (
    <button type="button" onClick={() => setSheet({})} aria-label="Plan an event" className="press grid h-11 w-11 place-items-center rounded-full bg-[#1c1b1a] text-white">
      <Icon name="plus" />
    </button>
  ) : undefined;

  if (!mounted || (!data && !failed)) {
    return (
      <div>
        <RoomHeader title="Coming up" action={plus} />
        <div className="skeleton h-[230px] rounded-[28px]" aria-busy="true" aria-label="Loading" />
        <div className="skeleton mt-3 h-16 rounded-[22px]" />
      </div>
    );
  }
  if (!data) {
    return (
      <div>
        <RoomHeader title="Coming up" />
        <div className="rounded-[28px] bg-card p-4 shadow-card" role="alert">
          <p className="m-0 text-headline font-semibold">Couldn&rsquo;t load your celebrations.</p>
          <Button variant="secondary" className="mt-3 !bg-well" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const next = nextEvent(data.events);
  const rest = data.events.filter((e) => e.id !== next?.id);
  // Occasions not planned yet (the one the prompt above already offers is left out).
  const planned = new Set(data.events.filter((e) => e.status !== "cancelled").map((e) => occasionEventKey(e.occasionKey, e.date, e.forMemberId)));
  const prompted = new Set(data.prompts.flatMap((p) => (p.kind === "suggest" ? [p.occasion.key] : [])));
  const upcoming = data.occasions
    .filter((o) => o.days >= 0 && (o.kind !== "national" || o.days <= 30) && !planned.has(o.key) && !prompted.has(o.key))
    .sort((a, b) => a.days - b.days)
    .slice(0, 3);
  return (
    <div>
      <RoomHeader title="Coming up" subtitle="Birthdays and festivals ahead, and the celebrations you planned." action={plus} />
      <WishAhead viewer={viewer} />
      <EventPrompts prompts={data.prompts.filter((p) => p.kind !== "pick" || p.eventId !== next?.id)} onChange={() => void reload()} className="mb-4" />

      {next ? (
        <EventHero e={next} members={members} viewer={viewer} />
      ) : (
        <EmptyState
          position="center 45%"
          title="Nothing planned yet."
          line="A birthday, a festival, a family call."
          action={
            canPlan ? (
              <Button className="w-full" onClick={() => setSheet({})}>
                <Icon name="plus" size={18} />
                Plan an event
              </Button>
            ) : undefined
          }
        />
      )}

      {rest.length > 0 && (
        <>
          <SectionTitle>Also coming up</SectionTitle>
          <Carousel label="Also coming up" slide="72%">
            {rest.map((e) => (
              <EventMini key={e.id} e={e} members={members} viewer={viewer} />
            ))}
          </Carousel>
        </>
      )}

      <WeeklyCallCard />

      {visit && (
        <Link href="/together/visits" replace className="mt-4 flex min-h-[44px] items-center gap-1.5 text-callout font-medium text-ink-soft no-underline">
          <Icon name="rooms" size={15} /> {visit.title} is on Visits <Icon name="chevron" size={14} />
        </Link>
      )}

      <Boundary label="Coming up"><ComingUp occasions={upcoming} members={members} canPlan={canPlan} onPlan={(o) => setSheet({ occasion: o })} /></Boundary>

      <PlanSheet
        open={sheet !== null}
        preset={sheet ?? undefined}
        onClose={() => setSheet(null)}
        occasions={data.occasions}
        members={members}
        viewer={viewer}
        onCreated={(e) => {
          setSheet(null);
          router.push(`/gather/${e.id}`);
        }}
      />
    </div>
  );
}

/* ------------------------------------------- occasions not planned yet */
function ComingUp({ occasions, members, canPlan, onPlan }: { occasions: UpcomingOccasion[]; members: Member[]; canPlan: boolean; onPlan: (o: UpcomingOccasion) => void }) {
  if (!occasions.length) return null;
  return (
    <section aria-label="Birthdays and festivals ahead">
      <SectionTitle>Birthdays and festivals ahead</SectionTitle>
      <ul className="m-0 list-none divide-y divide-[var(--line)] overflow-hidden rounded-card bg-card p-0 shadow-card">
        {occasions.map((o) => {
          const d = new Date(`${o.date}T12:00:00Z`);
          const who = o.memberId ? members.find((m) => m.id === o.memberId) : undefined;
          return (
            <li key={o.key} className="flex items-center gap-3 p-3 pl-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-well text-center leading-none" aria-hidden="true">
                <span>
                  <span className="tnum block text-headline font-bold">{d.getUTCDate()}</span>
                  <span className="mt-0.5 block text-caption font-semibold uppercase tracking-[0.04em] text-ink-soft">{d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span>
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-body font-semibold leading-tight">{o.label}</span>
                <span className="mt-0.5 block text-callout text-ink-soft">{o.days === 0 ? "Today" : `In ${o.days} day${o.days > 1 ? "s" : ""}`}</span>
              </span>
              {who && <Avatar src={memberPhoto(who)} name={callName(who)} size={32} />}
              {canPlan && (
                <button type="button" onClick={() => onPlan(o)} aria-label={`Plan ${o.label}`} className="press h-11 shrink-0 rounded-full bg-[#1c1b1a] px-4 text-body font-semibold text-white">
                  Plan
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
