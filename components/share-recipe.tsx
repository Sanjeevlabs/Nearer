"use client";

import { useState } from "react";
import { slug } from "@/lib/card-kit";
import type { Recipe } from "@/lib/kinds";
import { recipeCard } from "@/lib/share-cards";
import { canShareRecipe } from "@/lib/share-rules";
import { postJson, useJson } from "@/lib/use-json";
import { COURSE_LOOK, totalTime } from "./recipe-art";
import { ShareButton, type ShareTarget } from "./share-sheet";
import type { StickerSpec } from "./sticker-maker";
import { useViewer } from "./viewer";

interface ShareInfo {
  token: string;
  refId: string;
  views: number;
}

/** "Shared publicly · Stop sharing", once a link exists. */
function PublicLinkLine({ recipeId }: { recipeId: string }) {
  const shares = useJson<{ shares: ShareInfo[] }>("/api/share");
  const [stopped, setStopped] = useState(false);
  const existing = shares.data?.shares.find((s) => s.refId === recipeId);
  if (stopped) return <p className="m-0 mt-3 text-center text-callout text-[#3d6b2a]">Stopped sharing. The link no longer works.</p>;
  if (!existing) return <p className="m-0 mt-3 text-center text-caption text-ink-faint">Share or Copy link makes a public link to a frozen copy of this recipe. You can stop it any time.</p>;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
      <span className="text-footnote text-ink-soft">Shared publicly · opened {existing.views}×</span>
      <button
        type="button"
        onClick={async () => {
          await postJson("/api/share", { token: existing.token }, "DELETE");
          await shares.reload();
          setStopped(true);
        }}
        className="h-10 text-callout font-semibold text-[#a32418]"
      >
        Stop sharing
      </button>
    </div>
  );
}

/**
 * Share one recipe beyond the family: an image card plus a link anyone can
 * open (a frozen copy, revocable), or a sticker of the dish. Grown-ups only,
 * as /api/share enforces.
 */
export function ShareRecipe({ recipe, cookName, photo = null, tone = "soft", iconOnly = false }: { recipe: Recipe; cookName: string; photo?: string | null; tone?: "soft" | "dark"; iconOnly?: boolean }) {
  const { viewer } = useViewer();
  if (!canShareRecipe(viewer)) return null;
  const look = COURSE_LOOK[recipe.course] ?? COURSE_LOOK.other;
  const headline = `${recipe.title}, from ${cookName}'s kitchen`;
  const asText = (url: string | null) =>
    [`${recipe.title} — from ${cookName}'s kitchen`, recipe.memory ? `“${recipe.memory}”` : "", "", "Ingredients:", ...recipe.ingredients.map((i) => `• ${i.item}${i.said || i.approx ? ` — ${i.said || i.approx}` : ""}`), "", "Method:", ...recipe.steps.map((s, n) => `${n + 1}. ${s.text}`), url ? `\nFull recipe: ${url}` : ""]
      .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
      .join("\n");
  const makeLink = async (): Promise<string | null> => {
    const out = await postJson<{ path: string }>("/api/share", { kind: "recipe", id: recipe.id });
    return out ? `${location.origin}${out.path}` : null;
  };

  const target = (): ShareTarget => ({
    title: `Share ${recipe.title}`,
    note: `Others see the recipe and that it’s ${cookName}’s. Never your family, voices or photos of people.`,
    filename: `${slug(recipe.title)}.png`,
    text: headline,
    render: (link) => recipeCard({ title: recipe.title, from: cookName, meta: [look.label, totalTime(recipe)].filter(Boolean).join(" · "), memory: recipe.memory, ingredients: recipe.ingredients, accent: look.accent, bg: look.bg, ink: look.ink, photo }, link),
    link: { existing: null, make: makeLink },
    extra: [
      {
        key: "whatsapp",
        label: "Send the link on WhatsApp",
        sub: "To a group or a friend",
        icon: "whatsapp",
        onClick: async () => {
          const url = await makeLink();
          if (!url) return "Couldn’t make a link. Try again.";
          window.open(`https://wa.me/?text=${encodeURIComponent(`${headline}\n${url}`)}`, "_blank", "noopener");
        },
      },
      {
        key: "text",
        label: "Copy as text",
        sub: "Paste anywhere, even without the link",
        icon: "edit",
        onClick: async () => {
          await navigator.clipboard?.writeText(asText(null)).catch(() => undefined);
          return "Recipe copied.";
        },
      },
    ],
    footer: <PublicLinkLine recipeId={recipe.id} />,
  });

  const sticker = (): StickerSpec => ({ kind: "recipe", title: "Recipe sticker", src: photo, source: { kind: "recipe", id: recipe.id }, label: `${cookName}'s ${recipe.title}`.slice(0, 40) });

  return <ShareButton target={target} sticker={sticker} tone={tone} iconOnly={iconOnly} label="Share" />;
}
