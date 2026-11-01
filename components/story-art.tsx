import type { Story } from "@/lib/kinds";
import { cn } from "@/lib/utils";

// Night-sky covers for stories, by theme: flat shapes, no people, no stock art.
export const THEME_LOOK: Record<Story["theme"], { label: string; sky: [string, string]; accent: string }> = {
  animals: { label: "Animals", sky: ["#23304f", "#3d5a80"], accent: "#f2c46d" },
  legends: { label: "Legends", sky: ["#2b2350", "#5b4a8b"], accent: "#f6d38b" },
  "our-village": { label: "Our village", sky: ["#1f3a44", "#3f6f73"], accent: "#f2b35b" },
  family: { label: "Family", sky: ["#3a2340", "#7a4a6b"], accent: "#f4b6a4" },
  funny: { label: "Funny", sky: ["#2e3a1f", "#5f7a3a"], accent: "#f7d26a" },
  lesson: { label: "A lesson", sky: ["#3a2b1f", "#7a5a3a"], accent: "#ffd27a" },
  lullaby: { label: "Lullaby", sky: ["#141c3a", "#2d3a6b"], accent: "#e8ecff" },
  other: { label: "Story", sky: ["#26303a", "#4a5a6b"], accent: "#f2c46d" },
};

function Motif({ theme, accent }: { theme: Story["theme"]; accent: string }) {
  switch (theme) {
    case "animals":
      return (
        <g fill={accent}>
          <ellipse cx="60" cy="70" rx="26" ry="18" />
          <circle cx="86" cy="62" r="12" />
          <path d="M94 66c6 6 6 14 2 20" stroke={accent} strokeWidth="5" fill="none" strokeLinecap="round" />
          <rect x="42" y="80" width="7" height="14" rx="3" />
          <rect x="66" y="80" width="7" height="14" rx="3" />
        </g>
      );
    case "legends":
      return (
        <g fill={accent}>
          <path d="M38 76l8-22 14 14 14-14 8 22z" />
          <rect x="38" y="76" width="44" height="8" rx="2" />
          <circle cx="60" cy="48" r="4" />
        </g>
      );
    case "our-village":
      return (
        <g>
          <path d="M30 74l18-16 18 16v18H30z" fill={accent} />
          <path d="M64 92c10-6 22-6 32 0" stroke={accent} strokeOpacity=".6" strokeWidth="4" fill="none" strokeLinecap="round" />
          <circle cx="86" cy="60" r="10" fill={accent} opacity=".85" />
        </g>
      );
    case "family":
      return (
        <g fill={accent}>
          <path d="M40 72l20-18 20 18v20H40z" />
          <path d="M60 66c-4-5-12-1-8 5l8 7 8-7c4-6-4-10-8-5z" fill="#fff" opacity=".85" />
        </g>
      );
    case "funny":
      return (
        <g>
          <circle cx="60" cy="66" r="24" fill={accent} />
          <circle cx="51" cy="60" r="3" fill="#2e3a1f" />
          <circle cx="69" cy="60" r="3" fill="#2e3a1f" />
          <path d="M48 70c6 8 18 8 24 0" stroke="#2e3a1f" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </g>
      );
    case "lesson":
      return (
        <g fill={accent}>
          <path d="M44 80h32l-4 8H48z" />
          <path d="M60 50c8 10 8 18 0 24-8-6-8-14 0-24z" />
        </g>
      );
    case "lullaby":
      return (
        <g fill={accent}>
          <path d="M70 44a22 22 0 1 0 12 38 18 18 0 1 1-12-38z" />
        </g>
      );
    default:
      return (
        <g fill={accent}>
          <path d="M34 54h24v34H34zM62 54h24v34H62z" opacity=".9" />
        </g>
      );
  }
}

export function StoryCover({ theme, className, label = false }: { theme: Story["theme"]; className?: string; label?: boolean }) {
  const look = THEME_LOOK[theme] ?? THEME_LOOK.other;
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ background: `linear-gradient(160deg, ${look.sky[0]}, ${look.sky[1]})` }}>
      <svg viewBox="0 0 120 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {[[14, 14], [30, 26], [100, 18], [86, 34], [20, 46], [108, 50], [52, 16]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.6 : 1} fill="#fff" opacity={0.75} />
        ))}
        <Motif theme={theme} accent={look.accent} />
      </svg>
      {label && <span className="absolute left-2 top-2 rounded-full bg-white/15 px-2 py-0.5 text-caption font-semibold text-white backdrop-blur">{look.label}</span>}
    </div>
  );
}
