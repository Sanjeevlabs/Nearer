"use client";

import type { HeightMark } from "@/lib/kinds";
import { shortDate } from "@/lib/kids";

// A doorframe with pencil marks: the child's height, one line per mark with its date.
// Pure CSS, no pictures. Marks are placed by their number on a scale that fits them; the
// labels are spaced so two close marks never overlap. Nothing is compared or judged.

const H = 300;
const GAP = 36;
const MAX = 7;

export function Doorframe({ marks, className = "" }: { marks: HeightMark[]; className?: string }) {
  const list = [...marks].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX);
  if (list.length === 0) return null;
  const cms = list.map((m) => m.cm);
  const lo = Math.min(...cms) - 6;
  const hi = Math.max(...cms) + 6;
  const y = (cm: number) => H - ((cm - lo) / Math.max(1, hi - lo)) * H;
  // Top to bottom, each label at least GAP below the one above it.
  const placed: { m: HeightMark; line: number; label: number }[] = [];
  for (const m of [...list].sort((a, b) => b.cm - a.cm || b.at.localeCompare(a.at))) {
    const line = y(m.cm);
    const above = placed[placed.length - 1];
    placed.push({ m, line, label: above ? Math.max(line, above.label + GAP) : line });
  }
  const last = list[list.length - 1];
  return (
    <figure data-ui="doorframe" className={`m-0 ${className}`} aria-label={`Height marks, newest ${last.cm} centimetres on ${shortDate(last.at)}`}>
      <div className="relative mx-auto flex w-full max-w-[320px] justify-center" style={{ height: H + 36 }}>
        <div className="relative h-full w-[150px] shrink-0" aria-hidden="true">
          {/* the frame: two posts and a lintel */}
          <div className="absolute inset-y-0 left-0 w-[14px] rounded-t-[4px] bg-[#b98a5a]" style={{ boxShadow: "inset -3px 0 0 rgba(0,0,0,.12)" }} />
          <div className="absolute inset-y-0 right-0 w-[14px] rounded-t-[4px] bg-[#b98a5a]" style={{ boxShadow: "inset 3px 0 0 rgba(0,0,0,.12)" }} />
          <div className="absolute inset-x-0 top-0 h-[14px] rounded-[4px] bg-[#a47848]" />
          <div className="absolute inset-x-[14px] bottom-0 top-[14px] bg-[#fbf3e4]" />
          <div className="absolute inset-x-0 bottom-0 h-[6px] bg-[#8d633a]" />
          {placed.map(({ m, line }, i) => (
            <span key={m.id} className="absolute left-[10px] h-[5px] w-[56px] rounded-full" style={{ top: 18 + line * (H - 40) / H, background: i === placed.length - 1 ? "#6a4a2a" : "#c95f3f", opacity: i === 0 ? 1 : 0.85 }} />
          ))}
        </div>
        <ul className="relative m-0 ml-1 list-none p-0" style={{ width: 150 }}>
          {placed.map(({ m, label }, i) => (
            <li key={m.id} className="absolute left-0 whitespace-nowrap leading-tight" style={{ top: 18 + label * (H - 40) / H - 12 }}>
              <span className="text-[17px] font-semibold text-ink">{m.cm % 1 ? m.cm.toFixed(1) : m.cm} cm</span>
              <span className="ml-1.5 text-[13px] text-ink-soft">{shortDate(m.at)}</span>
              {m.note && i === 0 && <span className="block max-w-[150px] truncate text-[12.5px] text-ink-soft">{m.note}</span>}
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
