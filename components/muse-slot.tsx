"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useEvents } from "@/lib/gather-client";
import { canInclude, canStartPortrait } from "@/lib/muse-portrait";
import { pickMuseSlot, SLOT_DISMISS_KEY, thisDayNote } from "@/lib/muse-slot";
import { cardCover, memberPhoto } from "@/lib/people";
import type { MuseSlot } from "@/lib/muse-slot";
import type { Card } from "@/lib/schemas";
import { Icon, Photo } from "./ui/kit";
import { useViewer } from "./viewer";

// "Muse made this for you": one card at most in "Now in the family", rotating
// weekly. Tap to make it real. It rotates weekly, so there is nothing to dismiss.

function readDismissed(): string | null {
  try {
    return localStorage.getItem(SLOT_DISMISS_KEY);
  } catch {
    return null;
  }
}

/** Which Muse card (if any) the family page shows now, and how to hide it for two weeks. */
export function useMuseSlot(cards: Card[]): { slot: MuseSlot | null; dismiss: () => void } {
  const { viewer, members, relationships } = useViewer();
  const [dismissedAt, setDismissedAt] = useState<string | null | undefined>(undefined);
  useEffect(() => setDismissedAt(readDismissed()), []);
  const faces = useMemo(() => members.filter((m) => memberPhoto(m) && canInclude(viewer, m, members, relationships)).length, [members, viewer, relationships]);
  // Decided on the client only (dismissal lives in this browser), so the server never renders it.
  // One Muse offer per screen: while Muse is already suggesting a celebration on this page, this card waits.
  const events = useEvents();
  const museBusy = (events.data === null && !events.failed) ||(events.data?.prompts ?? []).some((p) => p.kind === "suggest");
  const slot = useMemo(
    () => (dismissedAt === undefined || museBusy ? null : pickMuseSlot({ now: new Date(), dismissedAt, canPortrait: canStartPortrait(viewer), portraitPeople: faces, cards })),
    [dismissedAt, museBusy, viewer, faces, cards],
  );
  const dismiss = () => {
    const at = new Date().toISOString();
    try {
      localStorage.setItem(SLOT_DISMISS_KEY, at);
    } catch {
      /* private mode: hidden for this visit */
    }
    setDismissedAt(at);
  };
  return { slot, dismiss };
}

export function MuseSlide({ slot }: { slot: MuseSlot }) {
  const { viewer, members, relationships } = useViewer();
  const faces = members.filter((m) => memberPhoto(m) && canInclude(viewer, m, members, relationships));

  if (slot.kind === "portrait") {
    return (
      <article className="relative h-[236px] overflow-hidden rounded-[26px] bg-[#f3e6d0]" aria-label="Muse made this for you: a family portrait">
        <div className="absolute inset-x-0 top-6 flex justify-center" aria-hidden="true">
          {faces.slice(0, 5).map((m, i) => (
            <span key={m.id} className="relative -mx-2 block h-[84px] w-[84px] overflow-hidden rounded-full ring-4 ring-[#f3e6d0]" style={{ zIndex: 5 - Math.abs(2 - i), transform: `translateY(${Math.abs(2 - i) * 8}px)`, filter: "saturate(1.2) contrast(.95) blur(.3px)" }}>
              <Photo src={memberPhoto(m)!} alt="" sizes="100px" position="center 30%" />
            </span>
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" aria-hidden="true" />
        <Link href="/portrait" className="absolute inset-x-4 bottom-4 flex items-end gap-3 text-white no-underline">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[12px] uppercase tracking-[0.14em] text-white/75">
              <Icon name="sparkle" size={13} />
              Muse can paint this
            </span>
            <span className="block text-[19px] font-semibold leading-tight">A portrait of all of you</span>
          </span>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-black">
            <Icon name="chevron" size={18} />
          </span>
        </Link>
      </article>
    );
  }

  return (
    <article className="relative h-[236px] overflow-hidden rounded-[26px] bg-surface" aria-label="Muse found this for you">
      <Photo src={cardCover(slot.card, members)} alt="" sizes="440px" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/75" aria-hidden="true" />
      <Link href="/lane" className="absolute inset-x-4 bottom-4 block text-white no-underline">
        <span className="flex items-center gap-1.5 text-[12px] uppercase tracking-[0.14em] text-white/75">
          <Icon name="sparkle" size={13} />
          This day, {slot.years} year{slot.years === 1 ? "" : "s"} ago
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[17px] font-semibold leading-snug">{thisDayNote(slot.card, slot.years)}</span>
      </Link>
    </article>
  );
}
