"use client";

import { placeFromTz } from "@/lib/zones";
import { PersonDetails } from "@/components/person-details";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PhotoCard, VoiceRow } from "@/components/memory-card";
import { VideoPlaque, VoicePlaque } from "@/components/plaque";
import { households } from "@/lib/households";
import { useShell } from "@/components/shell";
import { EmptyLine, Icon, Monogram, Photo, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { daysUntilBirthday } from "@/lib/family";
import { callName, memberPhoto } from "@/lib/people";
import { useFamilyCards } from "@/lib/use-family";

// Time-zone ids name a zone, not a home (Asia/Kolkata covers all of India).
function localTime(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date());
  } catch {
    return "";
  }
}

// A person's album: their portrait, the time where they are, their voices as
// tracks and their photos. The dock on this screen talks to them.
export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const { members, relationships } = useViewer();
  const { refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const person = members.find((m) => m.id === id);
  const [now, setNow] = useState("");

  useEffect(() => {
    if (!person) return;
    setNow(localTime(person.tz));
    const t = window.setInterval(() => setNow(localTime(person.tz)), 30_000);
    return () => window.clearInterval(t);
  }, [person]);

  const mine = useMemo(() => (cards ?? []).filter((c) => c.authorId === id), [cards, id]);
  const voices = mine.filter((c) => c.type === "audio");
  const photos = mine.filter((c) => c.type !== "audio");

  if (!person) {
    return (
      <div>
        <RoomHeader title="Not found" />
        <EmptyLine>This person isn&rsquo;t in your family yet.</EmptyLine>
      </div>
    );
  }
  const photo = memberPhoto(person);
  const home = households(members, relationships).find((h) => h.elders && h.members.some((x) => x.id === person.id));
  const days = daysUntilBirthday(person.birthday);

  return (
    <div>
      <RoomHeader title={callName(person)} subtitle={`${person.firstName !== callName(person) ? `${person.firstName} · ` : ""}${placeFromTz(person.tz)}`} />
      <div className="relative h-[380px] overflow-hidden rounded-hero bg-surface" style={{ boxShadow: "0 24px 50px -20px rgba(80,45,25,.55)" }}>
        {photo ? (
          <Photo src={photo} alt={callName(person)} sizes="(max-width: 480px) 100vw, 440px" priority position="center 30%" />
        ) : (
          <div className="absolute inset-0">
            <Monogram name={callName(person)} size={380} />
          </div>
        )}
        <div className="glass absolute inset-x-2.5 bottom-2.5 flex items-center justify-between rounded-[20px] px-4 py-3">
          <div>
            <p className="m-0 text-[13px] text-white/80">It&rsquo;s {now || "…"} there</p>
            <p className="m-0 text-[17px] font-semibold">{!Number.isFinite(days) ? "Birthday not added yet" : days === 0 ? "Birthday today" : days === 1 ? "Birthday tomorrow" : `Birthday in ${days} days`}</p>
          </div>
        </div>
      </div>

      {person.role === "elder" && (
        <Link href={`/book?member=${encodeURIComponent(person.id)}`} className="press mt-4 flex items-center gap-3 rounded-[22px] bg-surface px-4 py-3.5 text-ink no-underline">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-white">
            <Icon name="book" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="voice block text-[18px] leading-tight">The book of {callName(person)}</span>
            <span className="block text-[13px] text-ink-soft">Their answers, in their own voice</span>
          </span>
          <Icon name="chevron" size={18} className="text-ink-faint" />
        </Link>
      )}

      <section aria-label="Voices" className="mt-8">
        <h2 className="m-0 mb-1 text-[20px]">Voice notes</h2>
        {cards === null ? (
          <div className="skeleton mt-3 h-16" />
        ) : voices.length === 0 ? (
          <EmptyLine>No voice notes from {callName(person)} yet. Ask them something.</EmptyLine>
        ) : (
          <>
            <div className="mt-3">
              <VoicePlaque card={voices[0]} />
            </div>
            {voices.length > 1 && (
              <div className="mt-4 divide-y divide-[var(--line)]">
                {voices.slice(1).map((c) => (
                  <VoiceRow key={c.id} card={c} showAuthor={false} />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {photos.length > 0 && (
        <section aria-label="Photos" className="mt-8">
          <h2 className="m-0 mb-3 text-[20px]">Moments</h2>
          <div className="space-y-4">
            {photos.map((c) => (c.type === "video" ? <VideoPlaque key={c.id} card={c} /> : <PhotoCard key={c.id} card={c} />))}
          </div>
        </section>
      )}
      <PersonDetails person={person} onChanged={() => undefined} />
    </div>
  );
}
