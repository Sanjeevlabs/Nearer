"use client";

import { LoadFailed } from "@/components/load-failed";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { COURSE_LOOK, RecipeCover, totalTime } from "@/components/recipe-art";
import { AddRecipeSheet, SurpriseSheet } from "@/components/kitchen-sheets";
import { useShell } from "@/components/shell";
import { ActionMenu, Avatar, Button, EmptyLine, Icon, RoomHeader, SectionTitle } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { COURSES } from "@/lib/kind-values";
import type { Attempt, Question, Recipe } from "@/lib/kinds";
import { resolveMediaUrl } from "@/lib/media-session";
import { canChange } from "@/lib/permissions";
import { callName, memberPhoto } from "@/lib/people";
import { cn } from "@/lib/utils";
import { postJson, useJson } from "@/lib/use-json";
import { Boundary } from "@/components/ui/boundary";

// The family Kitchen: a library of every recipe anyone in the family shares,
// shelved by the person who cooks it. Each dish belongs to someone, may be
// taught in their voice or on video, and carries everyone who has cooked it since.
export default function KitchenPage() {
  const { viewer, members, ready } = useViewer();
  const { openAdd } = useShell();
  const { data, failed, reload } = useJson<{ recipes: Recipe[]; attempts: Attempt[] }>("/api/kitchen");
  const asks = useJson<{ questions: Question[] }>("/api/keeper");
  const [asking, setAsking] = useState(false);
  const [query, setQuery] = useState("");
  const [course, setCourse] = useState<Recipe["course"] | "all">("all");
  const router = useRouter();
  // A scanned recipe card opens straight in the editor, for a person to check.
  const [sheet, setSheet] = useState<"add" | "surprise" | null>(null);
  const onSaved = (id: string) => { setSheet(null); router.push(`/kitchen/${id}`); };

  const byId = (id: string) => members.find((m) => m.id === id);
  const recipes = data?.recipes ?? [];
  const attemptsFor = (id: string) => (data?.attempts ?? []).filter((a) => a.recipeId === id);
  // The page draws once the family (who cooks what), the recipes and the questions asked of you are all in,
  // so no shelf appears late and nothing slides down.
  const loading = !ready || (data === null && !failed) || (asks.data === null && !asks.failed);
  const waiting = (asks.data?.questions ?? []).filter((q) => q.topic === "recipe" && !q.answeredCardId);
  const mine = waiting.filter((q) => q.toMemberId === viewer.id);
  const usedCourses = COURSES.filter((c) => recipes.some((r) => r.course === c));
  const q = query.trim().toLowerCase();
  const shown = recipes.filter((r) => (course === "all" || r.course === course) && (!q || r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.item.toLowerCase().includes(q))));
  // One shelf per cook: the elders first, then you, then everyone else.
  const rank = (id: string) => (byId(id)?.role === "elder" ? 0 : id === viewer.id ? 1 : 2);
  const shelves = Array.from(new Set(shown.map((r) => r.cookId)))
    .sort((a, b) => rank(a) - rank(b) || callName(byId(a)).localeCompare(callName(byId(b))))
    .map((id) => ({ cook: byId(id), list: shown.filter((r) => r.cookId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }))
    .filter((x): x is { cook: NonNullable<typeof x.cook>; list: Recipe[] } => Boolean(x.cook));
  const iHaveNone = data !== null && !recipes.some((r) => r.cookId === viewer.id);

  if (loading) {
    return (
      <div>
        <RoomHeader title="Recipes" subtitle="Every family recipe, shelved by who cooks it" />
        {/* The size of what replaces it: the three actions, the scan row, then one shelf of tiles. */}
        <div key="loading" aria-busy="true" aria-label="Loading recipes">
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-12 rounded-[20px]" />
            ))}
          </div>
          <div className="skeleton mt-2 h-[68px] rounded-[20px]" />
          <div className="mb-3 mt-7 flex items-center gap-2.5">
            <div className="skeleton h-[38px] w-[38px] rounded-full" />
            <div className="skeleton h-6 w-40 rounded-full" />
          </div>
          <div className="-mx-4 flex gap-3 overflow-hidden px-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-[164px] shrink-0">
                <div className="skeleton h-[136px] rounded-[22px]" />
                <div className="skeleton mt-2 h-[42px] rounded-[10px]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <RoomHeader title="Recipes" subtitle="Every family recipe, shelved by who cooks it" />

      {mine.length > 0 && (
        <section aria-label="Asked of you" className="mb-6 space-y-2">
          {mine.map((q) => {
            const by = q.askedBy ? byId(q.askedBy) : undefined;
            return (
              <div key={q.id} className="rounded-card bg-well p-4">
                <p className="m-0 text-footnote font-medium text-ink-soft">{by ? `${callName(by)} asked you` : "This week's question"}</p>
                <p className="voice m-0 mt-1 text-title leading-snug">“{q.text}”</p>
                <Button className="mt-3 w-full" onClick={() => openAdd("voice", { kind: "recipe", questionId: q.id, title: q.text.replace(/^How do you make your /i, "").replace(/\?$/, "") })}>
                  <Icon name="mic" size={18} />
                  Teach it in your voice
                </Button>
                <button type="button" className="mt-1 h-10 w-full text-callout font-medium text-ink-soft" onClick={async () => { await postJson("/api/keeper", { action: "remove", questionId: q.id }); await asks.reload(); }}>
                  Not this one
                </button>
              </div>
            );
          })}
        </section>
      )}

      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={() => setSheet("add")} className="press flex h-12 flex-col items-center justify-center gap-0.5 rounded-[20px] bg-accent text-callout font-semibold text-accent-ink">
          <Icon name="plus" size={18} />
          Add a recipe
        </button>
        <button type="button" onClick={() => setSheet("surprise")} className="press flex h-12 flex-col items-center justify-center gap-0.5 rounded-[20px] bg-surface text-callout font-semibold">
          Surprise me
        </button>
        <button type="button" onClick={() => setAsking((v) => !v)} aria-expanded={asking} className={cn("press flex h-12 flex-col items-center justify-center gap-0.5 rounded-[20px] text-callout font-semibold", asking ? "bg-black/80 text-white" : "bg-surface")}>
          <Icon name="reply" size={18} />
          Ask someone
        </button>
      </div>
      {sheet === "add" && <AddRecipeSheet onClose={() => setSheet(null)} onSaved={onSaved} />}
      {sheet === "surprise" && <SurpriseSheet onClose={() => setSheet(null)} onSaved={onSaved} />}
      {asking && <AskForRecipe onDone={() => { setAsking(false); void asks.reload(); }} />}

      {failed && !data && <LoadFailed what="The Kitchen" ui="kitchen-retry" onRetry={() => { void reload(); void asks.reload(); }} />}

      {recipes.length > 3 && (
        <label className="mt-5 flex h-11 items-center gap-2 rounded-full bg-surface px-4">
          <span className="sr-only">Search recipes</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${recipes.length} recipes or an ingredient`} className="min-w-0 flex-1 bg-transparent text-body outline-none" />
        </label>
      )}
      {usedCourses.length > 1 && (
        <div className="no-scrollbar -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4" role="radiogroup" aria-label="Course">
          {(["all", ...usedCourses] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={course === c} onClick={() => setCourse(c)} className={cn("press h-9 shrink-0 rounded-full px-3.5 text-callout font-medium", course === c ? "bg-accent text-accent-ink" : "bg-surface")}>
              {c === "all" ? "All" : COURSE_LOOK[c].label}
            </button>
          ))}
        </div>
      )}

      {shelves.map(({ cook, list }) => (
        <Boundary key={cook.id} label="This shelf"><section aria-label={`${callName(cook)}'s recipes`}>
          <div className="mb-3 mt-7 flex items-center gap-2.5">
            <Avatar src={memberPhoto(cook)} name={callName(cook)} size={38} />
            <h2 className="m-0 min-w-0 flex-1 truncate text-title">
              {cook.id === viewer.id ? "Your recipes" : `${callName(cook)}'s recipes`}
            </h2>
            {cook.id === viewer.id && (
              <Link href="/kitchen/new" className="text-callout font-semibold text-ink-soft no-underline">
                + Add
              </Link>
            )}
          </div>
          <ul className="no-scrollbar -mx-4 my-0 flex list-none snap-x scroll-px-4 gap-3 overflow-x-auto py-0 pb-1 pl-4 pr-4">
            {list.map((r) => (
              <RecipeTile key={r.id} recipe={r} attempts={attemptsFor(r.id)} canManage={canChange(viewer, r.cookId) || Boolean(r.addedBy && canChange(viewer, r.addedBy))} onDeleted={() => void reload()} />
            ))}
          </ul>
        </section></Boundary>
      ))}
      {recipes.length > 0 && shelves.length === 0 && <EmptyLine>No recipes match.</EmptyLine>}
      {iHaveNone && recipes.length > 0 && (
        <Link href="/kitchen/new" className="press mt-7 flex items-center gap-3 rounded-card bg-surface p-4 text-ink no-underline">
          <Avatar src={memberPhoto(viewer)} name={callName(viewer)} size={38} />
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold">Your shelf is empty</span>
            <span className="block text-footnote text-ink-soft">Share the one dish people ask you to make.</span>
          </span>
          <Icon name="chevron" size={18} className="text-ink-faint" />
        </Link>
      )}

      {waiting.filter((q) => q.toMemberId !== viewer.id).length > 0 && (
        <section aria-label="Waiting on a recipe">
          <SectionTitle>Waiting to be taught</SectionTitle>
          <ul className="m-0 list-none space-y-2 p-0">
            {waiting
              .filter((q) => q.toMemberId !== viewer.id)
              .map((q) => (
                <li key={q.id} className="flex items-center gap-3 rounded-[18px] bg-surface px-3 py-2.5">
                  <Avatar src={memberPhoto(byId(q.toMemberId))} name={callName(byId(q.toMemberId))} size={36} />
                  <span className="voice min-w-0 flex-1 text-body">“{q.text}”</span>
                  {q.askedBy === viewer.id && (
                    <ActionMenu
                      label="Question options"
                      actions={[{ label: "Withdraw the question", danger: true, confirm: "Withdraw it? They won't see it anymore.", onSelect: async () => { await postJson("/api/keeper", { action: "remove", questionId: q.id }); await asks.reload(); } }]}
                    />
                  )}
                </li>
              ))}
          </ul>
        </section>
      )}

      {data && recipes.length === 0 && (
        <div className="mt-6 rounded-hero bg-surface px-6 py-10 text-center">
          <p className="m-0 text-title font-semibold">The kitchen is waiting for its first recipe</p>
          <p className="mx-auto mt-2 max-w-[300px] text-body text-ink-soft">Ask the person whose cooking you miss most. They talk; Nearer writes the card; you cook it wherever you are.</p>
        </div>
      )}
    </div>
  );
}

/** One recipe on a shelf: cover, name, time, who has cooked it. */
function RecipeTile({ recipe, attempts, canManage, onDeleted }: { recipe: Recipe; attempts: Attempt[]; canManage: boolean; onDeleted: () => void }) {
  const photo = recipe.coverRef ?? attempts.find((a) => a.photoRef)?.photoRef ?? null;
  const look = COURSE_LOOK[recipe.course] ?? COURSE_LOOK.other;
  const time = totalTime(recipe);
  return (
    <li className="relative w-[164px] shrink-0 snap-start">
      <Link href={`/kitchen/${recipe.id}`} className="press block text-ink no-underline">
        <RecipeCover recipe={recipe} photo={photo ? (resolveMediaUrl(photo) ?? photo) : null} className="h-[136px] rounded-[22px]" />
        <p className="m-0 mt-2 line-clamp-2 text-body font-semibold leading-tight">{recipe.title}</p>
        <p className="m-0 mt-0.5 flex items-center gap-1 text-caption text-ink-soft">
          <span style={{ color: look.ink }}>{look.label}</span>
          {time && <span>· {time}</span>}
          {recipe.voiceCardId && <Icon name="mic" size={12} className="ml-0.5 text-ink-soft" />}
          {recipe.videoCardId && <Icon name="camera" size={12} className="text-ink-soft" />}
        </p>
        {recipe.scanRef && <p className="m-0 font-hand text-body leading-tight text-ink-soft">from the handwritten card</p>}
        {attempts.length > 0 && <p className="m-0 text-caption text-ink-soft">cooked {attempts.length}×</p>}
      </Link>
      {canManage && (
        <div className="absolute right-1.5 top-1.5">
          <ActionMenu
            label={`${recipe.title} options`}
            actions={[
              { label: "Edit", onSelect: () => void (window.location.href = `/kitchen/${recipe.id}?edit=1`) },
              { label: "Delete", danger: true, confirm: `Delete ${recipe.title}?`, onSelect: async () => { await postJson("/api/kitchen", { action: "delete-recipe", recipeId: recipe.id }); onDeleted(); } },
            ]}
          />
        </div>
      )}
    </li>
  );
}

function AskForRecipe({ onDone }: { onDone: () => void }) {
  const { viewer, members } = useViewer();
  const elders = members.filter((m) => m.id !== viewer.id);
  const [to, setTo] = useState(elders.find((m) => m.role === "elder")?.id ?? elders[0]?.id ?? "");
  const [dish, setDish] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const person = members.find((m) => m.id === to);
  return (
    <div className="mt-3 rounded-card bg-surface p-4">
      {sent ? (
        <p className="m-0 text-body">
          Asked. {sent} will see it at the top of their courtyard, and can answer by voice.
        </p>
      ) : (
        <>
          <p className="m-0 mb-2 text-footnote font-medium text-ink-soft">Ask</p>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {elders.map((m) => (
              <button key={m.id} type="button" onClick={() => setTo(m.id)} aria-pressed={to === m.id} className={cn("press flex h-11 shrink-0 items-center gap-2 rounded-full pl-1 pr-4 text-body font-medium", to === m.id ? "bg-accent text-accent-ink" : "bg-surface")}>
                <Avatar src={memberPhoto(m)} name={callName(m)} size={34} />
                {callName(m)}
              </button>
            ))}
          </div>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-footnote font-medium text-ink-soft">how they make their…</span>
            <input value={dish} onChange={(e) => setDish(e.target.value)} maxLength={60} placeholder="aloo paratha" className="h-12 w-full rounded-full bg-surface px-5 text-body outline-none focus:ring-2 focus:ring-marigold" />
          </label>
          <Button
            className="mt-3 w-full"
            disabled={busy || dish.trim().length < 2 || !to}
            onClick={async () => {
              setBusy(true);
              const out = await postJson("/api/kitchen", { action: "ask", toMemberId: to, dish: dish.trim() });
              setBusy(false);
              if (out) {
                setSent(callName(person));
                setTimeout(onDone, 1800);
              }
            }}
          >
            {busy ? "Asking…" : `Ask ${callName(person)}`}
          </Button>
        </>
      )}
    </div>
  );
}
