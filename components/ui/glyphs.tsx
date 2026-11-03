// Nearer's own small glyphs (24px grid, 1.75 rounded stroke in ink at 70%, a light
// petal tint inside). Reactions are ours, not the phone's emoji: Love, Blessing,
// Smile. The same strokes draw the dock's house. Stroke follows currentColor, so dark mode and glass work.
import type { Reaction } from "@/lib/schemas";

type Kind = Reaction["kind"];

const TINT: Record<Kind, string> = { love: "var(--petal-1)", bless: "var(--petal-5)", laugh: "var(--petal-2)" };
const NAME: Record<Kind, string> = { love: "Love", bless: "Blessing", laugh: "Smile" };

export const REACTION_LABEL = NAME;

const BASE = { stroke: "currentColor", strokeOpacity: 0.7, strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const STROKE = { ...BASE, fill: "none" } as const;

function Frame({ size, className, title, children }: { size: number; className?: string; title?: string; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false" data-glyph={title?.toLowerCase()}>
      {children}
    </svg>
  );
}

/** One reaction. `selected` = the fuller tint. Decorative unless `title` is given. */
export function ReactionGlyph({ kind, selected = false, size = 24, className, label = false }: { kind: Kind; selected?: boolean; size?: number; className?: string; label?: boolean }) {
  const tint = TINT[kind];
  const fill = selected ? 0.7 : 0.22;
  return (
    <Frame size={size} className={className} title={label ? NAME[kind] : undefined}>
      {kind === "love" && (
        <>
          {/* two overlapping petal circles make the lobes; the point closes below */}
          <circle cx="8.6" cy="9.6" r="4.2" fill={tint} fillOpacity={fill} />
          <circle cx="15.4" cy="9.6" r="4.2" fill={tint} fillOpacity={fill} />
          <path d="M12 20.2C7.2 16.9 4.6 13.8 4.6 10.6a4 4 0 0 1 7.4-2.1 4 4 0 0 1 7.4 2.1c0 3.2-2.6 6.3-7.4 9.6z" {...STROKE} />
        </>
      )}
      {kind === "bless" && (
        <>
          {/* two raised palms, as petals, with a small light above */}
          <path d="M11.2 20.4c-3.8 0-6.2-2.6-6.2-6 0-2 .9-3.9 2.7-5.3 1.4 1.6 3.5 3.1 3.5 6.2z" fill={tint} fillOpacity={fill} {...BASE} />
          <path d="M12.8 20.4c3.8 0 6.2-2.6 6.2-6 0-2-.9-3.9-2.7-5.3-1.4 1.6-3.5 3.1-3.5 6.2z" fill={tint} fillOpacity={fill} {...BASE} />
          <circle cx="12" cy="4.6" r="1.5" fill={tint} fillOpacity={Math.min(1, fill + 0.3)} {...BASE} />
        </>
      )}
      {kind === "laugh" && (
        <>
          <circle cx="12" cy="12" r="8.4" fill={tint} fillOpacity={fill} {...BASE} />
          <path d="M8 13.6c1 1.9 2.4 2.9 4 2.9s3-1 4-2.9" {...STROKE} />
          <path d="M9.2 9.6h.01M14.8 9.6h.01" {...STROKE} strokeWidth={2.4} />
        </>
      )}
    </Frame>
  );
}

/** The dock's house: a roof over a small home, with a lit window. */
export function HouseGlyph({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Frame size={size} className={className}>
      <path d="M4.5 11 12 4.2 19.5 11v8.3a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z" fill="var(--petal-3)" fillOpacity={0.14} {...BASE} strokeOpacity={0.85} />
      <rect x="9.6" y="11.4" width="4.8" height="4.4" rx="1" {...STROKE} strokeOpacity={0.85} />
    </Frame>
  );
}
