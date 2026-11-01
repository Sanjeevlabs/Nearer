"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RoomHeader, Avatar, Icon } from "@/components/ui/kit";
import { Boundary } from "@/components/ui/boundary";
import { Doorframe } from "@/components/doorframe";
import { AddMark } from "@/components/height-marks";
import { FridgeBoard, Label, pill } from "@/components/kids-courtyard";
import { usePlayer } from "@/components/player";
import { useShell } from "@/components/shell";
import { useViewer } from "@/components/viewer";
import { guardiansOf, isKid } from "@/lib/kids";
import type { KidsPage } from "@/lib/kids-page";
import { callName, memberPhoto, relativeDay } from "@/lib/people";
import type { Card, Member } from "@/lib/schemas";
import { useJson } from "@/lib/use-json";

/** Family room, Kids tab: what the children shared, asked and were told, and their doorframes. Grown-ups only. */

const card = "mt-5 rounded-[26px] bg-surface p-5";
const Empty = ({ children }: { children: React.ReactNode }) => <p className="m-0 mt-2 text-[14.5px] leading-snug text-ink-soft">{children}</p>;

/** "3 Mar": the birthday has a day and a month, never a year, so there is no age to work out. */
function birthdayLine(m: Member): string | null {
  const [mm, dd] = m.birthday.split("-").map(Number);
  if (!mm || !dd) return null;
  return `Birthday ${new Date(Date.UTC(2001, mm - 1, dd)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}

function PlayPill({ voice, label }: { voice: Card | undefined; label: string }) {
  const { play, current, isPlaying, toggle } = usePlayer();
  if (!voice) return null;
  const playing = current?.id === voice.id && isPlaying;
  return (
    <button type="button" onClick={() => (current?.id === voice.id ? toggle() : play(voice))} aria-label={playing ? "Pause" : label} className="press flex h-11 items-center gap-2 rounded-full bg-well px-4 text-[14px] font-semibold">
      <Icon name={playing ? "pause" : "play"} size={14} />
      {playing ? "Pause" : "Play"}
    </button>
  );
}

function KidsBody({ data, reload }: { data: KidsPage; reload: () => Promise<void> }) {
  const { viewer, members, relationships } = useViewer();
  const { openAdd } = useShell();
  const [marking, setMarking] = useState<Member | null>(null);
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
              const last = data.fridge.find((c) => c.authorId === k.id);
              const bday = birthdayLine(k);
              return (
                <li key={k.id}>
                  <Link href={`/people/${k.id}`} className="flex items-center gap-3 text-ink no-underline">
                    <Avatar src={memberPhoto(k)} name={callName(k)} size={52} />
                    <span className="min-w-0">
                      <span className="block text-[18px] font-semibold leading-tight">{callName(k)}</span>
                      {bday && <span className="block text-[14px] leading-snug text-ink-soft">{bday}</span>}
                      <span className="block text-[14px] leading-snug text-ink-soft">{last ? `Last from ${callName(k)}: ${relativeDay(last.takenAt)}` : `Nothing from ${callName(k)} yet`}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section data-ui="kids-fridge" aria-label="Fridge" className="mt-5 rounded-[26px] p-5" style={{ background: "var(--well)" }}>
        <Label>Fridge</Label>
        {data.fridge.length === 0 ? <Empty>Nothing on the fridge yet. The kids&rsquo; photos and drawings land here.</Empty> : <FridgeBoard cards={data.fridge} replyTo={kids} grid />}
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
                  <p className="m-0 text-[16px] font-semibold">{a.topic === "story" ? `${who} would like a story` : `${who} asked you something`}</p>
                  {words &&
                    (a.answeredCardId && storyId ? (
                      <Link href={`/stories?new=${encodeURIComponent(storyId)}`} className="voice m-0 mt-0.5 block text-[17px] leading-snug text-ink">
                        &ldquo;{words}&rdquo; &rarr;
                      </Link>
                    ) : (
                      <p className="voice m-0 mt-0.5 line-clamp-3 text-[17px] leading-snug text-ink">&ldquo;{words}&rdquo;</p>
                    ))}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <PlayPill voice={q} label={`Play ${who}'s question`} />
                    {!a.answeredCardId && (
                      <button type="button" onClick={() => openAdd("voice", { kind: "kid_answer", askId: a.id, prompt: words || undefined }, [a.fromMemberId])} className={`${pill} bg-black text-white`}>
                        Answer by voice
                      </button>
                    )}
                    <span className="text-[12.5px] text-ink-soft">{a.answeredCardId && !storyId ? `Answered ${relativeDay(a.answeredAt ?? a.askedAt)}` : relativeDay(a.askedAt)}</span>
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
                <span className="min-w-0 text-[15px] leading-snug">
                  <span className="block font-semibold">
                    {nameOf(s.byMemberId)} for {nameOf(s.forMemberId)}
                  </span>
                  <span className="block text-[13px] text-ink-soft">{s.title ? `${s.title} · ${relativeDay(s.at)}` : relativeDay(s.at)}</span>
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

      <section data-ui="kids-doorframes" aria-label="Doorframes" className={card}>
        <Label>Doorframes</Label>
        {kids.length === 0 ? (
          <Empty>No doorframes yet. Each child gets one, with a mark for every time they are measured.</Empty>
        ) : (
          <div className="mt-3 space-y-6">
            {kids.map((k) => {
              const marks = data.marks.filter((m) => m.memberId === k.id);
              return (
                <div key={k.id} data-ui="kids-doorframe">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="m-0 text-[20px]">{callName(k)}</h2>
                    {mine(k) && (
                      <button type="button" onClick={() => setMarking(k)} className="press h-10 rounded-full bg-white px-4 text-[14px] font-semibold">
                        Add a mark
                      </button>
                    )}
                  </div>
                  {marks.length > 0 ? (
                    <div className="mt-3 rounded-[22px] bg-white px-0 py-5">
                      <Doorframe marks={marks} />
                    </div>
                  ) : (
                    <Empty>No marks yet for {callName(k)}.</Empty>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {marking && (
        <AddMark
          child={marking}
          onClose={() => setMarking(null)}
          onSaved={() => {
            setMarking(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

export default function KidsPageRoute() {
  const { viewer } = useViewer();
  const q = useJson<KidsPage>(isKid(viewer) ? null : "/api/kids");
  return (
    <div>
      <RoomHeader title="Kids" subtitle="What the children shared, asked and were told, and their doorframes" />
      {isKid(viewer) ? (
        <p className="m-0 text-[15px] text-ink-soft">This page is for the grown-ups. Your things are on your first screen.</p>
      ) : q.data === null ? (
        <div className="skeleton h-[420px] rounded-card" aria-busy="true" aria-label="Loading the kids" />
      ) : (
        <Boundary label="Kids">
          <KidsBody data={q.data} reload={q.reload} />
        </Boundary>
      )}
    </div>
  );
}
