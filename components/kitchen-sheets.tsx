"use client";

import { useEffect, useRef, useState } from "react";
import type { KitchenPreferences } from "@/lib/kinds";
import type { ChefPreview } from "@/lib/kitchen";
import { blobToWav16k } from "@/lib/media-client";
import { invalidateJson, postJson, useJson } from "@/lib/use-json";
import { RecipeCover } from "./recipe-art";
import { IngredientIcon } from "./ingredient-icon";
import { RecipeEditor, type Draft } from "./recipe-editor";
import { ScanRecipeButton, type ScanResult } from "./recipe-scan";
import { BottomSheet } from "./ui/bottom-sheet";
import { Button, Icon } from "./ui/kit";
import { useViewer } from "./viewer";
import { grantVoiceConsent, hasVoiceConsent } from "@/lib/voice-consent";

const field = "min-h-11 w-full rounded-xl bg-surface px-3 text-body";

function RecipeMic({ onText, label = "Tell us the recipe" }: { onText: (text: string) => void; label?: string }) {
  const { viewer } = useViewer();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const alive = useRef(true);
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState("idle");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(limit.current);
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  async function start() {
    setState("starting");
    try {
      const source = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) { source.getTracks().forEach((track) => track.stop()); return; }
      stream.current = source;
      const capture = new MediaRecorder(source);
      recorder.current = capture;
      const chunks: Blob[] = [];
      capture.ondataavailable = (event) => chunks.push(event.data);
      capture.onstop = async () => {
        clearTimeout(limit.current);
        source.getTracks().forEach((track) => track.stop());
        if (!alive.current) return;
        setState("reading");
        try {
          const wav = await blobToWav16k(new Blob(chunks, { type: capture.mimeType }));
          const body = new FormData();
          body.append("audio", new Blob([wav.bytes as unknown as BlobPart], { type: "audio/wav" }), "voice.wav");
          body.append("langHint", viewer.displayLang ?? "en");
          const response = await fetch("/api/transcribe", { method: "POST", body });
          const data = response.ok ? await response.json() : null;
          const text = data?.transcript?.transcript;
          if (!data || data.unavailable || !text?.trim()) throw new Error("no transcript");
          if (alive.current) { onText(text); setState("idle"); }
        } catch {
          if (alive.current) setState("error");
        }
      };
      capture.start();
      limit.current = setTimeout(() => { if (capture.state === "recording") capture.stop(); }, 120_000);
      setState("recording");
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      setState("error");
    }
  }
  function press() {
    if (state === "recording") { recorder.current?.stop(); return; }
    if (hasVoiceConsent(viewer.id)) void start();
    else setState("consent");
  }
  if (state === "consent") return <div className="space-y-2">
    <p className="text-callout">Meta’s AI transcribes the recording. Nearer uses the words to draft your recipe.</p>
    <Button onClick={() => {
      grantVoiceConsent(viewer.id);
      void start();
    }}>I understand, start recording</Button>
    <Button variant="quiet" onClick={() => setState("idle")}>Cancel</Button>
  </div>;
  return <>
    <Button variant="secondary" disabled={state === "reading" || state === "starting"} onClick={press}>
      <Icon name="mic" size={20} /> {state === "recording" ? "Stop recording" : state === "reading" ? "Listening…" : label}
    </Button>
    {state === "error" && <p role="alert">Couldn’t transcribe that. Try again or type it below.</p>}
  </>;
}

export function AddRecipeSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Partial<Draft> | null>(null);
  const [photo, setPhoto] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function prepare() {
    setBusy(true);
    setError(false);
    const result = await postJson<{ draft: Partial<Draft> }>("/api/kitchen", { action: "draft", text });
    setBusy(false);
    if (result?.draft) setPreview(result.draft);
    else setError(true);
  }
  return (
    <BottomSheet open title={preview ? "Check your recipe" : "Add a recipe"} onClose={onClose}>
      {preview ? <RecipeEditor prefill={preview} scan={photo?.scan} onDone={(id) => id ? onSaved(id) : onClose()} /> : <>
        <RecipeMic onText={(value) => setText(value.slice(0, 4000))} />
        <ScanRecipeButton onScanned={(result) => {
          setPhoto(result);
          if (!result.scan.fromMuse && text.trim()) void prepare();
          else setPreview(result.prefill);
        }} />
        <label className="mt-4 block text-body">Or type it
          <textarea className={field} rows={4} maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <Button disabled={busy || !text.trim()} onClick={() => void prepare()}>{busy ? "Preparing…" : "Preview recipe"}</Button>
        {error && <p role="alert">Couldn’t prepare the recipe. Try again.</p>}
      </>}
    </BottomSheet>
  );
}

export function SurpriseSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const { data, failed, reload } = useJson<{ prefs: KitchenPreferences }>("/api/kitchen?prefs=1");
  return <BottomSheet open title="Surprise me" onClose={onClose}>
    {data ? <SurpriseForm initial={data.prefs} onSaved={onSaved} /> : failed ? <Button onClick={() => void reload()}>Try again</Button> : <p role="status">Loading your preferences…</p>}
  </BottomSheet>;
}

function SurpriseForm({ initial, onSaved }: { initial: KitchenPreferences; onSaved: (id: string) => void }) {
  const [prefs, setPrefs] = useState(initial);
  const [draft, setDraft] = useState<ChefPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = <K extends keyof KitchenPreferences>(key: K, value: KitchenPreferences[K]) => setPrefs((previous) => ({ ...previous, [key]: value }));
  const tastes = prefs.taste.split(", ").filter(Boolean);
  function toggleTaste(taste: string, opposite: string) {
    const next = tastes.filter((value) => value !== taste && value !== opposite);
    if (!tastes.includes(taste)) next.push(taste);
    update("taste", next.join(", "));
  }
  async function suggest() {
    setBusy(true);
    setError("");
    const response = await postJson<{ draft: ChefPreview }>("/api/kitchen", { action: "surprise", prefs, previous: draft?.title });
    invalidateJson(["/api/kitchen?prefs=1"]);
    setBusy(false);
    if (response?.draft) setDraft(response.draft);
    else setError("Couldn’t find a recipe just now. Try again.");
  }
  async function keep() {
    if (!draft) return;
    setBusy(true);
    setError("");
    const response = await postJson<{ recipe: { id: string } }>("/api/kitchen", { action: "keep-idea", draft });
    setBusy(false);
    if (response?.recipe) onSaved(response.recipe.id);
    else setError("Couldn’t save the recipe. Try again.");
  }
  return <div className="space-y-3">
    {draft ? <>
      <RecipeCover recipe={{ title: draft.title, course: "main" }} className="h-32 rounded-xl" />
      <h3 className="text-title">{draft.title}</h3>
      <p className="text-body">{draft.memory}</p>
      <p className="text-body">Serves {draft.servings} · {draft.prepMins + draft.cookMins} min · about {draft.caloriesPerServing} kcal per serving</p>
      {draft.overCalories && <p role="status">This is above your calorie target.</p>}
      {draft.prepMins + draft.cookMins > prefs.minutes && <p role="status">This takes longer than the time you have.</p>}
      {draft.dietViolations.length > 0 && <p role="alert">This recipe may not fit your diet. Check these ingredients: {draft.dietViolations.join(", ")}.</p>}
      {draft.fallback && <p className="text-callout text-ink-soft">Muse couldn’t make a fresh suggestion. Here’s a simple backup recipe.</p>}
      <ul className="m-0 list-none space-y-2 p-0">{draft.ingredients.map((ingredient, index) => (
        <li key={index} className="flex items-center gap-2"><IngredientIcon item={ingredient.item} /><span>{ingredient.item} · {ingredient.said} · about {ingredient.kcal} kcal</span></li>
      ))}</ul>
      <ol className="list-decimal space-y-2 pl-5">{draft.steps.map((step, index) => <li key={index}>{step.text}{step.minutes > 0 && ` · ${step.minutes} min`}{step.tip && <p className="text-callout text-ink-soft">{step.tip}</p>}</li>)}</ol>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void keep()}>Keep it</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void suggest()}>Another</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setDraft(null)}>Change preferences</Button>
      </div>
    </> : <>
      <label className="block">What’s in your fridge? <textarea className={field} maxLength={600} value={prefs.fridge} onChange={(event) => update("fridge", event.target.value)} /></label>
      <RecipeMic label="Tell us what you have" onText={(value) => update("fridge", value.slice(0, 600))} />
      <div role="group" aria-label="Taste" className="flex flex-wrap gap-2">
        {[["Mild", "Spicy"], ["Spicy", "Mild"], ["Sweet", "Savoury"], ["Savoury", "Sweet"]].map(([taste, opposite]) => (
          <Button key={taste} variant={tastes.includes(taste) ? "primary" : "secondary"} aria-pressed={tastes.includes(taste)} onClick={() => toggleTaste(taste, opposite)}>{taste}</Button>
        ))}
      </div>
      <label className="block">Diet <input className={field} maxLength={120} placeholder="Vegetarian, gluten-free…" value={prefs.diet} onChange={(event) => update("diet", event.target.value)} /></label>
      <label className="block">Calories per serving (optional) <input className={field} type="number" min={1} max={10000} value={prefs.calories ?? ""} onChange={(event) => update("calories", event.target.valueAsNumber || null)} /></label>
      <label className="block">Minutes available <input className={field} type="number" min={1} max={1440} value={prefs.minutes || ""} onChange={(event) => update("minutes", event.target.valueAsNumber || 0)} /></label>
      <label className="block">Servings <input className={field} type="number" min={1} max={60} value={prefs.servings || ""} onChange={(event) => update("servings", event.target.valueAsNumber || 0)} /></label>
      <Button disabled={busy || prefs.minutes < 1 || prefs.minutes > 1440 || prefs.servings < 1 || prefs.servings > 60} onClick={() => void suggest()}>{busy ? "Thinking…" : "Find a recipe"}</Button>
    </>}
    <p className="text-callout text-ink-soft">Calories are estimates, not medical advice.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
