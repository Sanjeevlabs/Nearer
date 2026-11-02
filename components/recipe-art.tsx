import type { Recipe } from "@/lib/kinds";
import { cn } from "@/lib/utils";
import { Photo } from "./ui/kit";

// Shared by client pages and the public (server-rendered) recipe page, so no
// hooks here. A recipe without a photo still gets a cover: a warm, flat illustration by
// course (a bowl, a cup, a griddle…), never a stock photo or a fake dish.

export const COURSE_LOOK: Record<Recipe["course"], { label: string; bg: string; ink: string; accent: string }> = {
  breakfast: { label: "Breakfast", bg: "#fbefd9", ink: "#8a5a12", accent: "#f2a516" },
  main: { label: "Main", bg: "#f6e3d6", ink: "#8a3f1d", accent: "#d9733a" },
  side: { label: "Side", bg: "#e8f0dc", ink: "#456b26", accent: "#7fb069" },
  snack: { label: "Snack", bg: "#fbe6c8", ink: "#8a4b00", accent: "#e0912f" },
  sweet: { label: "Sweet", bg: "#f8e1e4", ink: "#8a2f45", accent: "#d97a8f" },
  drink: { label: "Drink", bg: "#e7ece0", ink: "#55603a", accent: "#b08a5a" },
  other: { label: "Other", bg: "#eeeae4", ink: "#5f5548", accent: "#a89580" },
};

function Motif({ course, accent, ink }: { course: Recipe["course"]; accent: string; ink: string }) {
  const steam = <path d="M46 22c-4 5 4 7 0 12M60 18c-4 5 4 7 0 12M74 22c-4 5 4 7 0 12" stroke={ink} strokeOpacity=".35" strokeWidth="3" strokeLinecap="round" fill="none" />;
  switch (course) {
    case "drink":
      return (
        <g>
          {steam}
          <path d="M38 44h44v20a18 18 0 0 1-18 18h-8a18 18 0 0 1-18-18V44z" fill={accent} />
          <path d="M82 50h6a8 8 0 0 1 0 16h-6" stroke={accent} strokeWidth="5" fill="none" />
          <ellipse cx="60" cy="88" rx="30" ry="5" fill={ink} opacity=".12" />
        </g>
      );
    case "sweet":
      return (
        <g>
          <path d="M28 70h64l-6 16H34z" fill={ink} opacity=".18" />
          <circle cx="44" cy="58" r="12" fill={accent} />
          <circle cx="62" cy="52" r="14" fill={accent} opacity=".85" />
          <circle cx="78" cy="60" r="11" fill={accent} opacity=".7" />
          <circle cx="62" cy="48" r="3" fill="#fff" opacity=".7" />
        </g>
      );
    case "breakfast":
      return (
        <g>
          {steam}
          <circle cx="60" cy="64" r="28" fill={accent} />
          <circle cx="60" cy="64" r="20" fill="#fff" opacity=".25" />
          <circle cx="52" cy="58" r="3" fill={ink} opacity=".3" />
          <circle cx="68" cy="70" r="3.5" fill={ink} opacity=".3" />
          <circle cx="64" cy="54" r="2.5" fill={ink} opacity=".3" />
        </g>
      );
    case "snack":
      return (
        <g>
          <path d="M26 66h68a34 20 0 0 1-68 0z" fill={ink} opacity=".2" />
          <circle cx="46" cy="60" r="10" fill={accent} />
          <circle cx="62" cy="56" r="11" fill={accent} opacity=".85" />
          <circle cx="76" cy="62" r="9" fill={accent} opacity=".75" />
        </g>
      );
    default:
      return (
        <g>
          {steam}
          <path d="M26 54h68a34 30 0 0 1-68 0z" fill={accent} />
          <ellipse cx="60" cy="54" rx="34" ry="7" fill="#fff" opacity=".35" />
          <ellipse cx="60" cy="90" rx="26" ry="4" fill={ink} opacity=".12" />
        </g>
      );
  }
}

export function RecipeCover({ recipe, photo, className, label = false }: { recipe: Pick<Recipe, "course" | "title">; photo?: string | null; className?: string; label?: boolean }) {
  const look = COURSE_LOOK[recipe.course] ?? COURSE_LOOK.other;
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ background: look.bg, contain: "layout paint" }}>
      {photo ? (
        <Photo src={photo} alt={recipe.title} sizes="360px" />
      ) : (
        <svg viewBox="0 0 120 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <circle cx="98" cy="14" r="26" fill={look.accent} opacity=".12" />
          <circle cx="14" cy="92" r="20" fill={look.accent} opacity=".1" />
          <Motif course={recipe.course} accent={look.accent} ink={look.ink} />
        </svg>
      )}
      {label && (
        <span className="absolute left-2 top-2 rounded-full bg-white/85 px-2 py-0.5 text-caption font-semibold" style={{ color: look.ink }}>
          {look.label}
        </span>
      )}
    </div>
  );
}

export function minutes(n: number | null | undefined): string {
  if (n == null) return "";
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function totalTime(r: Pick<Recipe, "prepMins" | "cookMins">): string {
  if (r.prepMins == null && r.cookMins == null) return "";
  return minutes((r.prepMins ?? 0) + (r.cookMins ?? 0));
}
