"use client";

import { AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlbumCover } from "@/components/albums";
import { LaneViewer } from "@/components/lane-viewer";
import { usePlayer } from "@/components/player";
import { useShell } from "@/components/shell";
import { Avatar, EmptyLine, Icon, Photo, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import type { Album } from "@/lib/kinds";
import { LANE_ROWS, laneGroups, monthChip, rangeLabel, type LaneKind } from "@/lib/lane-groups";
import { callName, cardCover, cardDuration, formatDuration, memberPhoto } from "@/lib/people";
import type { Card } from "@/lib/schemas";
import { useFamilyCards } from "@/lib/use-family";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { museLabel } from "@/lib/muse-portrait";
import { kidCards } from "@/lib/kids";
import { isOccasionAlbum } from "@/lib/occasion-album";
import { Boundary } from "@/components/ui/boundary";

// Memory Lane: the family's everyday photos and voices, by the years. Same
// kind together: albums, photos, videos and voices each get one swipe row
// (newest first, a month on every tile, the row's span in its header). Tap
// opens a full-screen viewer that swipes through that kind. Whatever another
// tab shows (occasions, stories, the Book, advice) stays there: /api/lane
// names those cards and the rows leave them out.

function RowHead({ title, count, range, extra }: { title: string; count: number; range?: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h2 className="m-0 text-headline">{title}</h2>
      <span className="tnum text-footnote text-ink-faint">{count}</span>
      <span className="flex-1" />
      {extra}
      {range && <span className="tnum text-caption text-ink-soft">{range}</span>}
    </div>
  );
}

function Tile({ card, kind, onOpen }: { card: Card; kind: LaneKind; onOpen: () => void }) {
  const { members } = useViewer();
  const { current, isPlaying } = usePlayer();
  const author = members.find((m) => m.id === card.authorId);
  const voice = kind === "audio";
  const label = voice ? `${callName(author)}'s voice note, ${monthChip(card.takenAt)}` : card.caption || `${kind === "video" ? "Video" : "Photo"}, ${monthChip(card.takenAt)}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      data-card={card.id}
      className={cn("press relative shrink-0 snap-start overflow-hidden rounded-[18px] bg-surface text-left", voice ? "h-[112px] w-[112px]" : "h-[150px] w-[120px]")}
    >
      <Photo src={cardCover(card, members)} alt="" sizes="240px" position="center 30%" />
      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.28),transparent_38%,transparent_58%,rgba(0,0,0,.55))]" aria-hidden="true" />
      <span className="glass absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-caption font-semibold">{monthChip(card.takenAt)}</span>
      {kind !== "photo" && (
        <span className="glass absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full">
          <Icon name={voice && current?.id === card.id && isPlaying ? "pause" : "play"} size={11} />
        </span>
      )}
      {museLabel(card.source) && (
        <span className="absolute bottom-7 left-1.5 flex items-center gap-0.5 rounded-full bg-white/90 px-1.5 py-0.5 text-caption font-semibold text-[#1c1b1a]">
          <Icon name="sparkle" size={10} />
          {museLabel(card.source)}
        </span>
      )}
      <span className="absolute bottom-2 left-2 right-10 truncate text-caption font-medium text-white">{voice ? `${callName(author)} · ${formatDuration(cardDuration(card))}` : callName(author)}</span>
    </button>
  );
}

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div aria-label={label} className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1">
      {children}
    </div>
  );
}

export default function LanePage() {
  const { members } = useViewer();
  const { refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const [who, setWho] = useState<string | null>(null);
  // /lane?from=kids (the window's "From the kids" tile): only what the children shared.
  const [kidsOnly, setKidsOnly] = useState(false);
  useEffect(() => {
    try {
      setKidsOnly(new URLSearchParams(window.location.search).get("from") === "kids");
    } catch {
      /* no location */
    }
  }, []);
  const shown = useMemo(() => (cards && kidsOnly ? kidCards(cards, members) : cards), [cards, kidsOnly, members]);
  const albumsQ = useJson<{ albums: Album[] }>(`/api/albums?k=${refreshKey}`);
  const elsewhereQ = useJson<{ elsewhere: string[] }>(`/api/lane?k=${refreshKey}`);
  const [sorting, setSorting] = useState<string | null>(null);
  const [open, setOpen] = useState<{ kind: LaneKind; index: number } | null>(null);

  // Until we know what the other tabs show, nothing is drawn (no flash of their cards). A failed lookup shows everything.
  const skip = useMemo(() => (elsewhereQ.data ? new Set(elsewhereQ.data.elsewhere) : elsewhereQ.failed ? new Set<string>() : null), [elsewhereQ.data, elsewhereQ.failed]);
  const groups = useMemo(() => (shown && skip ? laneGroups(shown, who, skip) : null), [shown, who, skip]);
  const albums = useMemo(() => {
    // Occasion albums (weddings, birthdays, festivals) live in Celebrations → Occasions, not here too.
    const all = (albumsQ.data?.albums ?? []).filter((a) => a.cardIds.length >= 2 && !isOccasionAlbum(a));
    const mine = who && cards ? all.filter((a) => a.cardIds.some((id) => cards.find((c) => c.id === id)?.authorId === who)) : all;
    return kidsOnly ? [] : [...mine].sort((a, b) => b.endAt.localeCompare(a.endAt));
  }, [albumsQ.data, who, cards, kidsOnly]);
  const total = groups ? groups.photo.length + groups.video.length + groups.audio.length : 0;
  // Only people with something on this page get a chip.
  const authors = useMemo(() => new Set((shown ?? []).filter((c) => !skip?.has(c.id)).map((c) => c.authorId)), [shown, skip]);
  const people = members.filter((m) => authors.has(m.id));
  // /lane?card=<id> (the inbox, "Waiting for you"): open that memory, or play it if it lives in another room.
  const { play } = usePlayer();
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !groups || !cards) return;
    let id: string | null = null;
    try {
      id = new URLSearchParams(window.location.search).get("card");
    } catch {
      /* no location */
    }
    deepLinked.current = true;
    if (!id) return;
    for (const r of LANE_ROWS) {
      const index = groups[r.kind].findIndex((c) => c.id === id);
      if (index >= 0) return setOpen({ kind: r.kind, index });
    }
    const card = cards.find((c) => c.id === id);
    if (card) play(card);
  }, [groups, cards, play]);
  const viewing = open && groups ? { list: groups[open.kind], title: LANE_ROWS.find((r) => r.kind === open.kind)?.title ?? "" } : null;

  const sortOlder = async () => {
    setSorting("busy");
    const out = await postJson<{ filed: number }>("/api/albums", { action: "resort" });
    await albumsQ.reload();
    setSorting(out ? (out.filed ? `Sorted ${out.filed}` : "All sorted") : "Try later");
  };

  return (
    <div>
      <RoomHeader title="Memory Lane" subtitle="Everyday photos and voices, by the years" />

      {groups !== null && (people.length > 1 || kidsOnly) && (
        <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4" role="radiogroup" aria-label="Show memories from">
          <button type="button" role="radio" aria-checked={who === null && !kidsOnly} onClick={() => { setWho(null); setKidsOnly(false); }} className={cn("press h-10 shrink-0 rounded-full px-4 text-callout font-medium", who === null && !kidsOnly ? "bg-accent text-accent-ink" : "bg-surface")}>
            Everyone
          </button>
          {kidsOnly && (
            <button type="button" role="radio" aria-checked onClick={() => setKidsOnly(false)} className="press h-10 shrink-0 rounded-full bg-accent px-4 text-callout font-medium text-accent-ink">
              From the kids
            </button>
          )}
          {people.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={who === m.id} onClick={() => { setWho(m.id); setKidsOnly(false); }} className={cn("press flex h-10 shrink-0 items-center gap-1.5 rounded-full pl-1 pr-3.5 text-callout font-medium", who === m.id ? "bg-accent text-accent-ink" : "bg-surface")}>
              <Avatar src={memberPhoto(m)} name={callName(m)} size={32} />
              {callName(m)}
            </button>
          ))}
        </div>
      )}

      {groups === null ? (
        <div key="loading" className="space-y-5" aria-busy="true" aria-label="Loading memories">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="skeleton mb-2 h-5 w-32" />
              <div className="flex gap-2.5 overflow-hidden">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className="skeleton h-[150px] w-[120px] shrink-0 rounded-[18px]" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : total === 0 && albums.length === 0 ? (
        <EmptyLine>{who ? "Nothing from them yet." : "Nothing here yet. Memories appear as the family shares them."}</EmptyLine>
      ) : (
        <div className="space-y-5">
          {!kidsOnly && (albums.length > 0 || (albumsQ.data && total > 0)) && cards && (
            <Boundary label="Albums"><section aria-label="Albums">
              <RowHead
                title="Albums"
                count={albums.length}
                extra={
                  <button
                    type="button"
                    onClick={sortOlder}
                    disabled={sorting === "busy"}
                    aria-label="Sort older photos into albums"
                    title="Sort older photos into albums"
                    className="press -my-2 flex h-9 items-center gap-1 rounded-full px-2 text-caption font-medium text-ink-soft"
                  >
                    <Icon name="wand" size={16} />
                    {sorting && sorting !== "busy" ? sorting : sorting === "busy" ? "…" : null}
                  </button>
                }
              />
              {albums.length > 0 ? (
                <Row label="Albums">
                  {albums.map((a) => (
                    <AlbumCover key={a.id} album={a} cards={cards} compact />
                  ))}
                </Row>
              ) : (
                <p className="m-0 text-callout text-ink-soft">No albums yet. Tap the wand to sort photos into albums.</p>
              )}
            </section></Boundary>
          )}

          {LANE_ROWS.map((r) => {
            const list = groups[r.kind];
            if (!list.length) return null;
            return (
              <Boundary key={r.kind} label={r.title}><section aria-label={r.title}>
                <RowHead title={r.title} count={list.length} range={rangeLabel(list)} />
                <Row label={r.title}>
                  {list.map((c, i) => (
                    <Tile key={c.id} card={c} kind={r.kind} onOpen={() => setOpen({ kind: r.kind, index: i })} />
                  ))}
                </Row>
              </section></Boundary>
            );
          })}
        </div>
      )}

      <AnimatePresence>{viewing && open && viewing.list.length > 0 && <LaneViewer key={open.kind} cards={viewing.list} start={open.index} title={viewing.title} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
}
