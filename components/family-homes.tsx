"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { circles, type CirclePerson } from "@/lib/circles";
import { householdName, households, type Household } from "@/lib/households";
import { callName, memberPhoto } from "@/lib/people";
import type { Member, Relationship } from "@/lib/schemas";
import { hourIn, placeFromTz, timeIn } from "@/lib/zones";
import { Avatar, Icon } from "./ui/kit";
import { useViewer } from "./viewer";

// The family, home by home: the parents' homes first (they are the heroes),
// each with its city, the time there and its people. Then the circles: at
// home, close family, and the wider family of in-laws and cousins.

function HomeCard({ home, labels, viewerId }: { home: Household; labels: Map<string, string>; viewerId: string }) {
  const h = hourIn(home.tz);
  const night = h < 6 || h >= 19;
  const people = [...home.members].sort((a, b) => (a.role === "elder" ? 0 : a.role === "adult" ? 1 : 2) - (b.role === "elder" ? 0 : b.role === "adult" ? 1 : 2));
  return (
    <li className={home.elders ? "rounded-card bg-[#fff6e6] p-4" : "rounded-card bg-surface p-4"}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="m-0 min-w-0 truncate text-body font-semibold">{home.members.some((m) => m.id === viewerId) ? "Your home" : householdName(home, (m) => callName(m))}</p>
        <p className="m-0 flex shrink-0 items-center gap-1 text-footnote text-ink-soft">
          <Icon name={night ? "moon" : "sun"} size={13} />
          {timeIn(home.tz)} · {placeFromTz(home.tz)}
        </p>
      </div>
      <ul className="no-scrollbar -mx-1 m-0 mt-3 flex list-none gap-3 overflow-x-auto p-0 px-1">
        {people.map((m) => (
          <li key={m.id} className="w-[64px] shrink-0">
            <Link href={`/people/${m.id}`} className="press flex flex-col items-center gap-1 text-center text-ink no-underline">
              <Avatar src={memberPhoto(m)} name={callName(m)} size={48} ring />
              <span className="max-w-full truncate text-footnote font-semibold">{m.id === viewerId ? "You" : callName(m)}</span>
              {labels.get(m.id) && <span className="-mt-1 max-w-full truncate text-caption text-ink-soft">{labels.get(m.id)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function FamilyHomes({ members, relationships }: { members: Member[]; relationships: Relationship[] }) {
  const { viewer } = useViewer();
  const homes = useMemo(() => {
    const mine = (h: Household) => h.members.some((m) => m.id === viewer.id);
    return [...households(members, relationships)].sort((a, b) => Number(b.elders) - Number(a.elders) || Number(mine(b)) - Number(mine(a)));
  }, [members, relationships, viewer.id]);
  const labels = useMemo(() => {
    const c = circles(members, relationships, viewer.id);
    return new Map([...c.home, ...c.close, ...c.wider].map((p) => [p.member.id, p.label]));
  }, [members, relationships, viewer.id]);
  if (homes.length === 0) return null;
  return (
    <section aria-label="Home by home" className="mt-2">
      <h2 className="m-0 mb-3 text-title">Home by home</h2>
      <ul className="m-0 list-none space-y-2 p-0">
        {homes.map((h) => (
          <HomeCard key={h.id} home={h} labels={labels} viewerId={viewer.id} />
        ))}
      </ul>
    </section>
  );
}


function CircleRow({ title, note, people }: { title: string; note: string; people: CirclePerson[] }) {
  const [open, setOpen] = useState(false);
  if (people.length === 0) return null;
  return (
    <li className="rounded-card bg-surface">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="press flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span data-display className="tnum w-9 shrink-0 text-display font-bold leading-none">{people.length}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold">{title}</span>
          <span className="block truncate text-footnote text-ink-soft">{note}</span>
        </span>
        <span className="flex shrink-0 -space-x-2">
          {people.slice(0, 4).map((p) => (
            <Avatar key={p.member.id} src={memberPhoto(p.member)} name={callName(p.member)} size={30} ring />
          ))}
        </span>
      </button>
      {open && (
        <ul className="m-0 grid list-none grid-cols-3 gap-2 px-3 pb-3 p-0">
          {people.map((p) => (
            <li key={p.member.id}>
              <Link href={`/people/${p.member.id}`} className="press flex flex-col items-center gap-1 rounded-[18px] bg-white px-1 py-3 text-center text-ink no-underline">
                <Avatar src={memberPhoto(p.member)} name={callName(p.member)} size={48} />
                <span className="max-w-full truncate text-callout font-semibold">{callName(p.member)}</span>
                {p.label && <span className="max-w-full truncate text-caption text-ink-soft">{p.label}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Home, close and wider: the in-laws and cousins get a place of their own. */
export function FamilyCircles({ members, relationships }: { members: Member[]; relationships: Relationship[] }) {
  const { viewer } = useViewer();
  const c = useMemo(() => circles(members, relationships, viewer.id), [members, relationships, viewer.id]);
  const words = (ps: CirclePerson[]) => Array.from(new Set(ps.map((p) => p.label.toLowerCase()).filter(Boolean))).slice(0, 3).join(", ");
  if (c.home.length + c.close.length + c.wider.length === 0) return null;
  return (
    <section aria-label="How close" className="mt-10">
      <h2 className="m-0 mb-3 text-title">How close</h2>
      <ul className="m-0 list-none space-y-2 p-0">
        <CircleRow title="At home" note={words(c.home) || "Under your roof"} people={c.home} />
        <CircleRow title="Close family" note={words(c.close) || "Parents, siblings, children"} people={c.close} />
        <CircleRow title="Wider family" note={words(c.wider) || "In-laws, cousins, aunts and uncles"} people={c.wider} />
      </ul>
    </section>
  );
}
