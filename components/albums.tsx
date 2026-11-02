"use client";

import Link from "next/link";
import type { Album } from "@/lib/kinds";
import { resolveMediaUrl } from "@/lib/media-session";
import type { Card } from "@/lib/schemas";
import { Photo } from "./ui/kit";

export const EVENT_LABEL: Record<Album["event"], string> = {
  wedding: "Weddings",
  ritual: "Pujas & rituals",
  festival: "Festivals",
  birthday: "Birthdays",
  gathering: "Together",
  trip: "Trips",
  food: "Food",
  nature: "Outdoors",
  school: "School",
  everyday: "Everyday",
};

export function cardImage(c: Card | undefined): string | null {
  if (!c) return null;
  const ref = c.mediaRef ?? c.coverRef;
  return ref ? (resolveMediaUrl(ref) ?? ref) : null;
}

export function albumDates(a: Pick<Album, "startAt" | "endAt">): string {
  const s = new Date(a.startAt);
  const e = new Date(a.endAt);
  const fmt = (d: Date, year: boolean) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
  if (s.toDateString() === e.toDateString()) return fmt(s, true);
  return `${fmt(s, s.getFullYear() !== e.getFullYear())} – ${fmt(e, true)}`;
}

/** Big cover card, Apple-Memories style: photo, title, dates, how many. */
export function AlbumCover({ album, cards, wide = false, compact = false, eager = false }: { album: Album; cards: Card[]; wide?: boolean; compact?: boolean; eager?: boolean }) {
  const inAlbum = album.cardIds.map((id) => cards.find((c) => c.id === id)).filter((c): c is Card => Boolean(c));
  const cover = cards.find((c) => c.id === album.coverId) ?? inAlbum[0];
  const src = cardImage(cover);
  return (
    <Link href={`/lane/album/${album.id}`} className={`press relative block shrink-0 overflow-hidden rounded-hero bg-[#1c1c1e] text-white no-underline ${wide ? "h-[220px] w-full" : compact ? "h-[176px] w-[148px] snap-start" : "h-[230px] w-[200px] snap-start"}`} style={{ boxShadow: "0 18px 36px -20px rgba(0,0,0,.5)" }}>
      {src && <Photo src={src} alt="" sizes={wide ? "440px" : "220px"} position="center 30%" priority={eager} />}
      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_40%,rgba(0,0,0,.72))]" aria-hidden="true" />
      <span className="absolute inset-x-3.5 bottom-3">
        <span className="block text-caption font-semibold uppercase tracking-[0.08em] text-white/75">{EVENT_LABEL[album.event]}</span>
        <span className={`mt-0.5 line-clamp-2 block font-bold leading-tight ${compact ? "text-body" : "text-headline"}`}>{album.title}</span>
        <span className="mt-0.5 block text-caption text-white/80">
          {compact ? `${inAlbum.length} · ${albumDates(album)}` : `${albumDates(album)} · ${inAlbum.length} ${inAlbum.length === 1 ? "photo" : "photos"}`}
        </span>
      </span>
    </Link>
  );
}
