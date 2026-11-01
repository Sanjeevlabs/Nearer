"use client";

import type { ReactNode } from "react";
import { Avatar, Photo } from "@/components/ui/kit";
import { VENUES, assignSeats, type SeatKind, type Venue, type VenueId } from "@/lib/venues";

// The place the family sits: the venue photo behind everything, a faint seat
// where nobody is, and each person's face on their own seat. What goes inside
// (the video "table") is the child of the scene.

export type Sitter = { id: string; name: string; photo: string | null; child: boolean };

const SHAPE: Record<SeatKind, string> = {
  chair: "h-11 w-11 rounded-[14px]",
  sofa: "h-11 w-[68px] rounded-[18px]",
  cushion: "h-9 w-9 rounded-full",
  swing: "h-11 w-14 rounded-t-[22px] rounded-b-[10px]",
};

export function VenueScene({ venue, sitters, children }: { venue: Venue; sitters: Sitter[]; children: ReactNode }) {
  const seats = assignSeats(venue, sitters);
  const seated = new Set(seats.keys());
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#1c1b1a]">
      <Photo src={venue.image} sizes="100vw" priority />
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/55" aria-hidden="true" />
      <ul className="pointer-events-none absolute inset-0 m-0 list-none p-0" aria-label={`Seats in the ${venue.name.toLowerCase()}`}>
        {venue.seats.map((s, i) => (
          <li key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${s.x}%`, top: `${s.y}%` }}>
            <span aria-hidden="true" className={`block bg-white/10 ring-1 ring-white/25 ${SHAPE[s.kind]}`} />
          </li>
        ))}
        {sitters
          .filter((p) => seated.has(p.id))
          .map((p) => {
            const s = seats.get(p.id)!;
            return (
              <li key={p.id} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: `${s.x}%`, top: `${s.y}%` }}>
                <span className={`grid place-items-center bg-black/35 p-[3px] shadow-[0_6px_14px_rgba(0,0,0,.35)] ring-1 ring-white/40 ${SHAPE[s.kind]}`}>
                  <Avatar src={p.photo} name={p.name} size={p.child ? 30 : 36} />
                </span>
                <span className="mt-0.5 max-w-[72px] truncate text-caption font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.7)]">{p.name}</span>
              </li>
            );
          })}
      </ul>
      {children}
    </div>
  );
}

/** A row of venue thumbnails; the chosen one wears a ring. */
export function VenuePicker({ value, onChange }: { value: VenueId; onChange: (id: VenueId) => void }) {
  return (
    <div role="radiogroup" aria-label="Where to sit" className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 py-1">
      {VENUES.map((v) => {
        const on = v.id === value;
        return (
          <button key={v.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(v.id)} className="press w-[84px] shrink-0 text-left text-white">
            <span className={`relative block h-[56px] w-full overflow-hidden rounded-[14px] ${on ? "ring-2 ring-white ring-offset-2 ring-offset-[#1c1b1a]" : "opacity-75 ring-1 ring-white/20"}`}>
              <Photo src={v.image} sizes="84px" />
            </span>
            <span className="mt-1 block truncate text-caption font-semibold">{v.name}</span>
          </button>
        );
      })}
    </div>
  );
}
