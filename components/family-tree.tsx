"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { callName, memberPhoto } from "@/lib/people";
import type { Member, Relationship } from "@/lib/schemas";
import { NODE, treeLayout } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { placeFromTz } from "@/lib/zones";
import { Icon, Monogram, Photo } from "./ui/kit";

// A node tree (SPEC §29.6): the shape everyone already reads. Generations in
// rows, couples joined by a short line, an elbow from each couple down to
// their children. Scrolls sideways; opens centred on you.

const PAD = 28;

export function FamilyTree({ members, relationships, viewerId, onAdd }: { members: Member[]; relationships: Relationship[]; viewerId: string; onAdd?: (anchorId: string) => void }) {
  const t = useMemo(() => treeLayout(members, relationships, viewerId), [members, relationships, viewerId]);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const box = useRef<HTMLDivElement>(null);
  const me = t.nodes.find((n) => n.id === viewerId);
  useEffect(() => {
    if (box.current && me) box.current.scrollLeft = me.x + PAD - box.current.clientWidth / 2;
  }, [me]);
  const gens = new Set(t.nodes.map((n) => n.gen)).size;
  const cities = new Set(members.map((m) => m.city || placeFromTz(m.tz))).size;
  const W = t.width + PAD * 2;
  const H = t.height + PAD;

  return (
    <div data-ui="family-tree">
      <p className="m-0 mb-3 text-callout text-ink-soft">
        {members.length} people · {gens} generation{gens === 1 ? "" : "s"} · {cities} {cities === 1 ? "city" : "cities"}
      </p>
      <div ref={box} className="no-scrollbar -mx-4 overflow-x-auto rounded-[28px] bg-[#faf7f2] ring-1 ring-[var(--line)]" style={{ scrollBehavior: "smooth" }}>
        <div className="relative" style={{ width: W, height: H }}>
          <svg className="absolute inset-0" width={W} height={H} aria-hidden="true">
            <g transform={`translate(${PAD},${PAD / 2})`} fill="none" stroke="#c9b9a3" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              {t.couples.map((c) => (
                <line key={c.a + c.b} x1={c.x1 + NODE / 2 - 2} x2={c.x2 - NODE / 2 + 2} y1={c.y} y2={c.y} stroke="#d9a441" strokeWidth={2.5} />
              ))}
              {t.links.map((l, i) => {
                const mid = l.from.y + (Math.min(...l.to.map((c) => c.y)) - l.from.y) / 2 + 14;
                const xs = l.to.map((c) => c.x);
                const d = [`M${l.from.x} ${l.from.y} V${mid}`, `M${Math.min(l.from.x, ...xs)} ${mid} H${Math.max(l.from.x, ...xs)}`, ...l.to.map((c) => `M${c.x} ${mid} V${c.y}`)].join(" ");
                return <path key={i} d={d} />;
              })}
            </g>
          </svg>
          {t.nodes.map((n) => {
            const m = byId.get(n.id);
            if (!m) return null;
            const photo = memberPhoto(m);
            const you = n.id === viewerId;
            return (
              <div key={n.id} className="absolute flex w-[88px] -translate-x-1/2 flex-col items-center" style={{ left: n.x + PAD, top: n.y + PAD / 2 - NODE / 2 }}>
                <Link href={`/people/${m.id}`} className="press block rounded-full no-underline" aria-label={`${callName(m)}${you ? " (you)" : ""}`}>
                  <span className={cn("relative block overflow-hidden rounded-full bg-white", you ? "ring-[3px] ring-ink ring-offset-2 ring-offset-[#faf7f2]" : "ring-2 ring-white shadow-[0_8px_18px_-10px_rgba(60,40,20,.6)]")} style={{ width: NODE, height: NODE }}>
                    {photo ? <Photo src={photo} alt="" sizes="128px" position="center 30%" /> : <Monogram name={callName(m)} size={NODE} />}
                  </span>
                </Link>
                <span className="mt-1.5 max-w-full truncate text-center text-footnote font-semibold leading-tight text-ink">{you ? "You" : callName(m)}</span>
                <span className="max-w-full truncate text-center text-caption leading-tight text-ink-soft">{m.city || placeFromTz(m.tz)}</span>
                {onAdd && (
                  <button type="button" onClick={() => onAdd(m.id)} aria-label={`Add someone related to ${callName(m)}`} className="press absolute -right-0 top-[40px] grid h-7 w-7 place-items-center rounded-full bg-white text-ink-soft shadow ring-1 ring-[var(--line)]">
                    <Icon name="plus" size={14} strokeWidth={2.4} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {t.loose.length > 0 && (
        <p className="m-0 mt-3 text-footnote text-ink-soft">
          Not linked yet: {t.loose.map((id) => callName(byId.get(id))).join(", ")}. Add how they&rsquo;re related to place them.
        </p>
      )}
    </div>
  );
}
