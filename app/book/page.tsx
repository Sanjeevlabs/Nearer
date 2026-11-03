"use client";

import { LoadFailed } from "@/components/load-failed";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Chapter } from "@/app/api/book/chapters";
import { byYear } from "@/app/api/book/chapters";
import { usePlayer } from "@/components/player";
import { EmptyLine, Icon, Monogram, Photo, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { callName, memberPhoto } from "@/lib/people";
import { useDisplayText } from "@/lib/use-display-text";
import { useJson } from "@/lib/use-json";
import { Boundary } from "@/components/ui/boundary";

// The Book of Maa & Papa (SPEC §30.4): their daily answers, kept as chapters
// of a life story, in their own voice.

function ChapterPage({ chapter, n }: { chapter: Chapter; n: number }) {
  const { displayLang } = useViewer();
  const { play, current, isPlaying, toggle } = usePlayer();
  const card = chapter.card;
  const words = card.transcript || card.caption;
  const { text } = useDisplayText(words, card.transcript ? card.transcriptLang : card.lang, displayLang);
  const playing = current?.id === card.id && isPlaying;
  const date = new Date(chapter.at).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return (
    <article className="rounded-[26px] bg-surface px-4 py-5" data-card={card.id}>
      <p className="m-0 text-caption uppercase tracking-[0.18em] text-ink-soft">
        Chapter {n} · {date}
      </p>
      <h3 className="m-0 mt-2 text-title font-semibold leading-snug">{chapter.title}</h3>
      {words && <p className="voice m-0 mt-3 text-headline leading-[1.45] text-ink">&ldquo;{text ?? words}&rdquo;</p>}
      <button
        type="button"
        onClick={() => (current?.id === card.id ? toggle() : play(card))}
        aria-label={playing ? "Pause" : "Play this answer in their voice"}
        className="press mt-4 flex h-11 items-center gap-2 rounded-full bg-accent pl-1.5 pr-4 text-callout font-semibold text-accent-ink"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-black">
          <Icon name={playing ? "pause" : "play"} size={15} />
        </span>
        {playing ? "Playing" : "Hear it"}
      </button>
    </article>
  );
}

function Book() {
  const params = useSearchParams();
  const { members, ready, viewer } = useViewer();
  // No one named: your own book if you have one (a parent), else the first of the grandparent generation.
  const elders = members.filter((m) => m.role === "elder");
  const memberId = params.get("member") ?? (elders.find((m) => m.id === viewer.id) ?? elders[0])?.id ?? "";
  const person = members.find((m) => m.id === memberId);
  const { data, failed, reload } = useJson<{ chapters: Chapter[] }>(ready && memberId ? `/api/book?member=${encodeURIComponent(memberId)}` : null);
  const name = callName(person);
  const photo = memberPhoto(person);

  if (ready && !person)
    return (
      <div>
        <RoomHeader title="The Book" />
        <EmptyLine>This person isn&rsquo;t in your family yet.</EmptyLine>
      </div>
    );

  const chapters = data?.chapters ?? [];
  const years = byYear(chapters);
  let n = chapters.length + 1;

  return (
    <div>
      <RoomHeader title="The Book" subtitle={`${name}, in their own voice`} />
      {elders.length > 1 && (
        <nav aria-label="Whose book" className="-mt-3 mb-4 flex gap-1.5">
          {elders.map((e) => (
            <Link key={e.id} href={`/book?member=${encodeURIComponent(e.id)}`} replace scroll={false} aria-current={e.id === memberId ? "page" : undefined} className={`press flex h-9 items-center rounded-full px-4 text-callout font-medium no-underline ${e.id === memberId ? "bg-accent text-accent-ink" : "bg-tint text-ink"}`}>
              {callName(e)}
            </Link>
          ))}
        </nav>
      )}
      <section aria-label="Cover" className="relative h-[300px] overflow-hidden rounded-[28px] bg-deep text-white" style={{ boxShadow: "0 24px 50px -24px rgba(60,35,20,.6)" }}>
        {photo ? <Photo src={photo} alt="" sizes="440px" priority position="center 28%" /> : <Monogram name={name} size={300} />}
        <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-black/20 to-black/80" aria-hidden="true" />
        <div className="absolute inset-x-5 bottom-5">
          <p className="m-0 text-caption uppercase tracking-[0.22em] text-white/70">In their own voice</p>
          <p data-display className="voice m-0 mt-1 text-display leading-[1.05]">The book of {name}</p>
          {chapters.length > 0 && (
            <p className="m-0 mt-2 text-footnote text-white/75">
              {chapters.length} chapter{chapters.length > 1 ? "s" : ""}
            </p>
          )}
        </div>
      </section>

      {chapters.length > 0 && (
        <Link href={`/book/print?member=${encodeURIComponent(memberId)}`} className="press mt-4 flex h-12 items-center justify-center gap-2 rounded-full bg-surface px-5 text-callout font-semibold text-ink no-underline">
          <Icon name="download" size={16} />
          Download the book
        </Link>
      )}

      {failed && !data ? (
        <div className="mt-6">
          <LoadFailed what="The book" ui="book-retry" onRetry={() => void reload()} />
        </div>
      ) : data === null ? (
        <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading">
          <div className="skeleton h-[150px] rounded-[26px]" />
          <div className="skeleton h-[150px] rounded-[26px]" />
        </div>
      ) : chapters.length === 0 ? (
        <p className="voice m-0 mt-8 px-2 text-center text-title leading-snug text-ink-soft">Every answer {name} gives to the daily question becomes a page here.</p>
      ) : (
        years.map((y) => (
          <section key={y.year} aria-label={String(y.year)} className="mt-8">
            <h2 className="m-0 mb-3 text-footnote font-semibold uppercase tracking-[0.2em] text-ink-soft">{y.year}</h2>
            <div className="space-y-3">
              {y.chapters.map((c) => {
                n -= 1;
                return <Boundary key={c.id} label="This chapter"><ChapterPage chapter={c} n={n} /></Boundary>;
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={<div className="skeleton mt-16 h-[300px] rounded-[28px]" aria-busy="true" />}>
      <Book />
    </Suspense>
  );
}
