"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { RoomHeader, Avatar, Icon } from "@/components/ui/kit";
import { Boundary } from "@/components/ui/boundary";
import { FridgeBoard, Label, pill } from "@/components/kids-courtyard";
import { usePlayer } from "@/components/player";
import { useShell } from "@/components/shell";
import { useViewer } from "@/components/viewer";
import { dayMonthLabel } from "@/lib/birthday";
import { fridgeKidId, guardiansOf, isKid } from "@/lib/kids";
import type { KidsPage } from "@/lib/kids-page";
import { ageOf, callName, memberPhoto, relativeDay } from "@/lib/people";
import type { Card, Member } from "@/lib/schemas";
import { useJson } from "@/lib/use-json";

/** Family room, Kids tab: what the children shared, asked and were told. Grown-ups only. */

const card = "mt-5 rounded-[26px] bg-surface p-4";
const Empty = ({ children }: { children: React.ReactNode }) => <p className="m-0 mt-2 text-callout leading-snug text-ink-soft">{children}</p>;

/** "Age 9 · Birthday 9 Nov": the age only when the birth year is known, the birthday only when it is added. */
function ageLine(m: Member): string | null {
  const age = ageOf(m);
  const day = dayMonthLabel(m.birthday);
  const parts = [age !== null ? `Age ${age}` : null, day ? `Birthday ${day}` : null].filter((x): x is string => Boolean(x));
  return parts.length ? parts.join(" · ") : null;
}

function PlayPill({ voice, label }: { voice: Card | undefined; label: string }) {
  const { play, current, isPlaying, toggle } = usePlayer();
  if (!voice) return null;
  const playing = current?.id === voice.id && isPlaying;
  return (
    <button type="button" onClick={() => (current?.id === voice.id ? toggle() : play(voice))} aria-label={playing ? "Pause" : label} className="press flex h-11 items-center gap-2 rounded-full bg-well px-4 text-callout font-semibold">
      <Icon name={playing ? "pause" : "play"} size={14} />
      {playing ? "Pause" : "Play"}
    </button>
  );
}

function KidsBody({ data }: { data: KidsPage }) {
  const { viewer, members, relationships } = useViewer();
  const { openAdd } = useShell();
  const kids = useMemo(() => data.kids.map((id) => members.find((m) => m.id === id)).filter((m): m is Member => Boolean(m)), [data.kids, members]);
  const mine = (kid: Member) => !isKid(viewer) && guardiansOf(kid.id, relationships).includes(viewer.id);
  const voice = (id: string | null) => (id ? data.voices.find((c) => c.id === id) : undefined);
  const nameOf = (id: string) => callName(members.find((m) => m.id === id));
  const open = data.asks.filter((a) => !a.answeredCardId);
  const answered = data.asks.filter((a) => a.answeredCardId);

  return (
    <>
      <section data-ui="kids-list" aria-label="The kids" className={card}>
        <Label>The kids</Label>
        {kids.length === 0 ? (
          <Empty>No children in the family yet. When one joins, they show up here.</Empty>
        ) : (
          <ul className="m-0 mt-3 list-none space-y-3 p-0">
            {kids.map((k) => {
              const last = data.fridge.find((c) => fridgeKidId(c) === k.id);
              const bday = ageLine(k);
              return (
                <li key={k.id}>
                  <Link href={`/people/${k.id}`} className="flex items-center gap-3 text-ink no-underline">
                    <Avatar src={memberPhoto(k)} name={callName(k)} size={44} />
                    <span className="min-w-0">
                      <span className="block text-headline font-semibold leading-tight">{callName(k)}</span>
                      {bday && <span className="block text-callout leading-snug text-ink-soft">{bday}</span>}
                      <span className="block text-callout leading-snug text-ink-soft">{last ? `Last from ${callName(k)}: ${relativeDay(last.takenAt)}` : `Nothing from ${callName(k)} yet`}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section data-ui="kids-fridge" aria-label="Fridge" className="mt-5 rounded-[26px] p-4" style={{ background: "var(--well)" }}>
        <div className="flex items-center justify-between gap-3">
          <Label>Fridge</Label>
          {kids.length > 0 && (
            <button type="button" onClick={() => openAdd("photos", { kind: "fridge", ...(kids.length === 1 ? { forMemberId: kids[0].id } : {}) })} className="press -mr-2 flex h-10 items-center gap-1.5 px-2 text-callout font-semibold text-ink">
              <Icon name="plus" size={15} />
              Add to the fridge
            </button>
          )}
        </div>
        {data.fridge.length === 0 ? <Empty>Nothing on the fridge yet. The kids&rsquo; photos and drawings land here, and you can add one for a child who does not have an account.</Empty> : <FridgeBoard cards={data.fridge} replyTo={kids} grid />}
      </section>

      <section data-ui="kids-asked" aria-label="Asked" className={card}>
        <Label>Asked</Label>
        {data.asks.length === 0 ? (
          <Empty>No questions yet. When a child asks you something, it waits here.</Empty>
        ) : (
          <ul className="m-0 mt-2 list-none space-y-4 p-0">
            {[...open, ...answered].map((a) => {
              const q = voice(a.cardId);
              const words = a.text || q?.transcript || q?.caption || "";
              const who = nameOf(a.fromMemberId);
              const storyId = data.askStory[a.id];
              return (
                <li key={a.id}>
                  <p className="m-0 text-body font-semibold">{a.topic === "story" ? `${who} would like a story` : `${who} asked you something`}</p>
                  {words &&
                    (a.answeredCardId && storyId ? (
                      <Link href={`/stories?new=${encodeURIComponent(storyId)}`} className="voice m-0 mt-0.5 block text-headline leading-snug text-ink">
                        &ldquo;{words}&rdquo; &rarr;
                      </Link>
                    ) : (
                      <p className="voice m-0 mt-0.5 line-clamp-3 text-headline leading-snug text-ink">&ldquo;{words}&rdquo;</p>
                    ))}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <PlayPill voice={q} label={`Play ${who}'s question`} />
                    {!a.answeredCardId && (
                      <button type="button" onClick={() => openAdd("voice", { kind: "kid_answer", askId: a.id, prompt: words || undefined }, [a.fromMemberId])} className={`${pill} bg-black text-white`}>
                        Answer by voice
                      </button>
                    )}
                    <span className="text-caption text-ink-soft">{a.answeredCardId && !storyId ? `Answered ${relativeDay(a.answeredAt ?? a.askedAt)}` : relativeDay(a.askedAt)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section data-ui="kids-bedtime" aria-label="Bedtime stories" className={card}>
        <Label>
          <Icon name="moon" size={13} className="mr-1 inline align-[-2px]" />
          Bedtime stories
        </Label>
        {data.stories.length === 0 ? (
          <Empty>No bedtime stories yet. A few minutes in your voice is all it takes.</Empty>
        ) : (
          <ul className="m-0 mt-2 list-none space-y-3 p-0">
            {data.stories.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-body leading-snug">
                  <span className="block font-semibold">
                    {nameOf(s.byMemberId)} for {nameOf(s.forMemberId)}
                  </span>
                  <span className="block text-footnote text-ink-soft">{s.title ? `${s.title} · ${relativeDay(s.at)}` : relativeDay(s.at)}</span>
                </span>
                <PlayPill voice={voice(s.cardId)} label={`Play ${nameOf(s.byMemberId)}'s story for ${nameOf(s.forMemberId)}`} />
              </li>
            ))}
          </ul>
        )}
        {kids.some(mine) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {kids.filter(mine).map((k) => (
              <button key={k.id} type="button" onClick={() => openAdd("voice", { kind: "bedtime", forMemberId: k.id }, [k.id])} className={`${pill} bg-black text-white`}>
                Record one for {callName(k)}
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export default function KidsPageRoute() {
  const { viewer } = useViewer();
  const q = useJson<KidsPage>(isKid(viewer) ? null : "/api/kids");
  // A photo added from the sheet bumps the shell's refresh key: read the page again.
  const { refreshKey } = useShell();
  const seen = useRef(refreshKey);
  const { reload } = q;
  useEffect(() => {
    if (seen.current === refreshKey) return;
    seen.current = refreshKey;
    void reload();
  }, [refreshKey, reload]);
  return (
    <div>
      <RoomHeader title="Kids" subtitle="What the children shared, asked and were told" />
      {isKid(viewer) ? (
        <p className="m-0 text-body text-ink-soft">This page is for the grown-ups. Your things are on your first screen.</p>
      ) : q.data === null ? (
        <div className="skeleton h-[420px] rounded-card" aria-busy="true" aria-label="Loading the kids" />
      ) : (
        <Boundary label="Kids">
          <KidsBody data={q.data} />
        </Boundary>
      )}
    </div>
  );
}
