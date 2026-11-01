"use client";

import { useState } from "react";
import { COURSES } from "@/lib/kind-values";
import type { Recipe } from "@/lib/kinds";
import { callName } from "@/lib/people";
import { useFamilyCards } from "@/lib/use-family";
import { postJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { COURSE_LOOK } from "./recipe-art";
import { Avatar, Button, Icon, RoomHeader, SectionTitle } from "./ui/kit";
import { memberPhoto } from "@/lib/people";
import { useViewer } from "./viewer";

export type Draft = Pick<Recipe, "title" | "memory" | "serves" | "course" | "prepMins" | "cookMins" | "prepWork" | "outcome" | "ingredients" | "steps" | "voiceCardId" | "videoCardId"> & { cookId: string };

const blank = (cookId: string): Draft => ({
  title: "",
  memory: "",
  serves: "",
  course: "main",
  prepMins: null,
  cookMins: null,
  prepWork: [],
  outcome: "",
  ingredients: [{ item: "", said: "", approx: "" }],
  steps: [{ text: "", tip: "" }],
  voiceCardId: null,
  videoCardId: null,
  cookId,
});

const field = "h-[48px] w-full rounded-[14px] bg-white px-4 text-body outline-none focus:ring-2 focus:ring-marigold";

/**
 * One editor for a new recipe and for corrections. The cook's words win:
 * amounts stay as they say them ("one katori"), with an optional rough guide.
 */
/** A recipe card Muse read from a photo: the photo stays on the recipe. */
export interface ScanInfo {
  ref: string;
  url: string | null;
  /** False when Muse couldn't read it (the editor opens empty, photo attached). */
  fromMuse: boolean;
}

export function RecipeEditor({ recipe, onDone, prefill, scan }: { recipe?: Recipe; onDone: (id?: string) => void; prefill?: Partial<Draft>; scan?: ScanInfo }) {
  const { viewer, members } = useViewer();
  const { cards } = useFamilyCards();
  const [d, setD] = useState<Draft>(() => (recipe ? { ...recipe, prepWork: [...recipe.prepWork], ingredients: recipe.ingredients.map((i) => ({ ...i })), steps: recipe.steps.map((s) => ({ ...s })) } : { ...blank(viewer.id), ...prefill }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const mine = (cards ?? []).filter((c) => c.authorId === d.cookId || c.authorId === viewer.id);
  const voices = mine.filter((c) => c.type === "audio");
  const videos = mine.filter((c) => c.type === "video");
  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.min(1440, Math.round(Number(v)) || 0)));

  const save = async () => {
    const ingredients = d.ingredients.filter((x) => x.item.trim());
    const steps = d.steps.filter((x) => x.text.trim());
    if (!d.title.trim()) return setError("Give it a name.");
    if (!ingredients.length || !steps.length) return setError("Add at least one ingredient and one step.");
    setBusy(true);
    const body = {
      title: d.title.trim(),
      memory: d.memory.trim(),
      serves: d.serves.trim(),
      course: d.course,
      prepMins: d.prepMins,
      cookMins: d.cookMins,
      prepWork: d.prepWork.map((p) => p.trim()).filter(Boolean),
      outcome: d.outcome.trim(),
      ingredients,
      steps,
      voiceCardId: d.voiceCardId,
      videoCardId: d.videoCardId,
    };
    const out = await postJson<{ recipe?: Recipe }>("/api/kitchen", recipe ? { action: "edit", recipeId: recipe.id, ...body } : { action: "create", cookId: d.cookId, ...(scan ? { scanRef: scan.ref } : {}), ...body });
    setBusy(false);
    if (!out) return setError("Couldn't save. Try again.");
    onDone(out.recipe?.id);
  };

  return (
    <div>
      <RoomHeader title={recipe ? "Edit recipe" : scan ? "Check the recipe" : "Add a recipe"} subtitle={recipe ? "Fix anything. The cook's words win." : scan ? "Nothing is saved until you add it" : "Your own, or one you're writing down for someone"} />

      {scan && (
        <figure className="m-0 mb-5 flex items-center gap-3 rounded-card bg-[#fff6e6] p-3">
          {scan.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={scan.url} alt="The recipe card" className="h-[84px] w-[68px] shrink-0 rounded-[12px] object-cover" />
          )}
          <figcaption className="min-w-0">
            <span className="block font-hand text-title leading-tight text-[#8a4b00]">In {d.cookId === viewer.id ? "your" : `${callName(members.find((m) => m.id === d.cookId))}'s`} handwriting</span>
            <span className="mt-0.5 block text-footnote text-ink-soft">{scan.fromMuse ? "Muse read this card. Check every line against it, then add it." : "Muse couldn't read this one. Type it in from the photo; it stays with the recipe."}</span>
          </figcaption>
        </figure>
      )}

      {!recipe && (
        <>
          <p className="m-0 mb-2 text-footnote font-semibold uppercase tracking-[0.06em] text-ink-faint">Whose recipe</p>
          <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4">
            {members.map((m) => (
              <button key={m.id} type="button" aria-pressed={d.cookId === m.id} onClick={() => set("cookId", m.id)} className={cn("press flex h-11 shrink-0 items-center gap-2 rounded-full pl-1 pr-4 text-body font-medium", d.cookId === m.id ? "bg-black text-white" : "bg-surface")}>
                <Avatar src={memberPhoto(m)} name={callName(m)} size={34} />
                {m.id === viewer.id ? "Mine" : callName(m)}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="space-y-2.5 rounded-card bg-surface p-4">
        <input className={cn(field, "text-headline font-semibold")} value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={80} placeholder="Palak paneer" aria-label="Recipe name" />
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1" role="radiogroup" aria-label="Course">
          {COURSES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={d.course === c} onClick={() => set("course", c)} className={cn("press h-9 shrink-0 rounded-full px-3.5 text-callout font-medium", d.course === c ? "bg-black text-white" : "bg-white")}>
              {COURSE_LOOK[c].label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-soft">Prep (min)</span>
            <input className={field} inputMode="numeric" value={d.prepMins ?? ""} onChange={(e) => set("prepMins", num(e.target.value))} placeholder="15" />
          </label>
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-soft">Cook (min)</span>
            <input className={field} inputMode="numeric" value={d.cookMins ?? ""} onChange={(e) => set("cookMins", num(e.target.value))} placeholder="25" />
          </label>
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-soft">Serves</span>
            <input className={field} value={d.serves} onChange={(e) => set("serves", e.target.value)} maxLength={40} placeholder="4" />
          </label>
        </div>
        <textarea className="w-full resize-none rounded-[14px] bg-white p-4 text-body outline-none focus:ring-2 focus:ring-marigold" rows={2} value={d.memory} onChange={(e) => set("memory", e.target.value)} maxLength={240} placeholder="Why it matters (Sunday breakfast, with white butter)" aria-label="Why it matters" />
      </div>

      <SectionTitle>Before you start</SectionTitle>
      <Lines values={d.prepWork} onChange={(v) => set("prepWork", v)} placeholder="Soak the dal 30 min" add="Add prep" max={12} />

      <SectionTitle>Ingredients</SectionTitle>
      <ul className="m-0 list-none space-y-2 p-0">
        {d.ingredients.map((ing, i) => (
          <li key={i} className="grid grid-cols-[1.2fr_1fr_0.9fr_36px] gap-1.5">
            <input className={field} value={ing.item} onChange={(e) => set("ingredients", d.ingredients.map((x, k) => (k === i ? { ...x, item: e.target.value } : x)))} placeholder="toor dal" aria-label={`Ingredient ${i + 1}`} />
            <input className={field} value={ing.said} onChange={(e) => set("ingredients", d.ingredients.map((x, k) => (k === i ? { ...x, said: e.target.value } : x)))} placeholder="one katori" aria-label="Amount, as you'd say it" />
            <input className={field} value={ing.approx} onChange={(e) => set("ingredients", d.ingredients.map((x, k) => (k === i ? { ...x, approx: e.target.value } : x)))} placeholder="≈ 1 cup" aria-label="Rough guide" />
            <button type="button" aria-label="Remove ingredient" onClick={() => set("ingredients", d.ingredients.filter((_, k) => k !== i))} className="press grid h-[48px] place-items-center text-ink-faint">
              <Icon name="close" size={16} />
            </button>
          </li>
        ))}
      </ul>
      <AddRow onClick={() => set("ingredients", [...d.ingredients, { item: "", said: "", approx: "" }])} label="Add ingredient" />

      <SectionTitle>Steps</SectionTitle>
      <ol className="m-0 list-none space-y-2 p-0">
        {d.steps.map((st, i) => (
          <li key={i} className="rounded-[16px] bg-surface p-2.5">
            <div className="flex gap-1.5">
              <span className="tnum mt-3 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-black text-caption font-bold text-white">{i + 1}</span>
              <textarea className="w-full resize-none rounded-[12px] bg-white p-3 text-body outline-none focus:ring-2 focus:ring-marigold" rows={2} value={st.text} onChange={(e) => set("steps", d.steps.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} aria-label={`Step ${i + 1}`} />
              <button type="button" aria-label="Remove step" onClick={() => set("steps", d.steps.filter((_, k) => k !== i))} className="press grid w-9 place-items-center text-ink-faint">
                <Icon name="close" size={16} />
              </button>
            </div>
            <input className={`${field} mt-1.5 h-[42px] text-body`} value={st.tip} onChange={(e) => set("steps", d.steps.map((x, k) => (k === i ? { ...x, tip: e.target.value } : x)))} placeholder="A tip in your words (optional)" aria-label={`Tip for step ${i + 1}`} />
          </li>
        ))}
      </ol>
      <AddRow onClick={() => set("steps", [...d.steps, { text: "", tip: "" }])} label="Add step" />

      <SectionTitle>How you know it&rsquo;s right</SectionTitle>
      <textarea className="w-full resize-none rounded-[14px] bg-surface p-4 text-body outline-none focus:ring-2 focus:ring-marigold" rows={2} value={d.outcome} onChange={(e) => set("outcome", e.target.value)} maxLength={240} placeholder="Thick enough to coat a spoon; smells of ghee" aria-label="How you know it's right" />

      {(voices.length > 0 || videos.length > 0) && (
        <>
          <SectionTitle>Voice and video</SectionTitle>
          <div className="space-y-2">
            {voices.length > 0 && (
              <select className={cn(field, "bg-surface")} value={d.voiceCardId ?? ""} onChange={(e) => set("voiceCardId", e.target.value || null)} aria-label="Voice note">
                <option value="">No voice note</option>
                {voices.map((c) => (
                  <option key={c.id} value={c.id}>
                    🎙 {c.caption || c.transcript.slice(0, 40) || "Voice note"}
                  </option>
                ))}
              </select>
            )}
            {videos.length > 0 && (
              <select className={cn(field, "bg-surface")} value={d.videoCardId ?? ""} onChange={(e) => set("videoCardId", e.target.value || null)} aria-label="Video">
                <option value="">No video</option>
                {videos.map((c) => (
                  <option key={c.id} value={c.id}>
                    🎬 {c.caption || "Video"}
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      )}

      {error && <p className="m-0 mt-4 text-callout text-[#b42318]" role="alert">{error}</p>}
      <div className="mt-6 flex gap-2">
        <Button className="flex-[1.4]" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : recipe ? "Save recipe" : "Add to the Kitchen"}
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => onDone()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AddRow({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="press mt-2 flex h-10 items-center gap-1.5 text-callout font-semibold">
      <Icon name="plus" size={16} />
      {label}
    </button>
  );
}

function Lines({ values, onChange, placeholder, add, max }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; add: string; max: number }) {
  return (
    <>
      <ul className="m-0 list-none space-y-2 p-0">
        {values.map((v, i) => (
          <li key={i} className="flex gap-1.5">
            <input className={cn(field, "bg-surface")} value={v} onChange={(e) => onChange(values.map((x, k) => (k === i ? e.target.value : x)))} maxLength={160} placeholder={placeholder} aria-label={`Prep ${i + 1}`} />
            <button type="button" aria-label="Remove" onClick={() => onChange(values.filter((_, k) => k !== i))} className="press grid w-9 place-items-center text-ink-faint">
              <Icon name="close" size={16} />
            </button>
          </li>
        ))}
      </ul>
      {values.length < max && <AddRow onClick={() => onChange([...values, ""])} label={add} />}
    </>
  );
}
