"use client";

import { useEffect, useRef, useState } from "react";
import type { KitchenPreferences } from "@/lib/kinds";
import { blobToWav16k } from "@/lib/media-client";
import { invalidateJson, postJson, useJson } from "@/lib/use-json";
import { RecipeCover } from "./recipe-art";
import { RecipeEditor, type Draft } from "./recipe-editor";
import { ScanRecipeButton, type ScanResult } from "./recipe-scan";
import { BottomSheet } from "./ui/bottom-sheet";
import { Button, Icon } from "./ui/kit";

const field = "min-h-11 w-full rounded-xl bg-surface px-3 text-body";

function RecipeMic({ onText, label = "Tell us the recipe" }: { onText: (text: string) => void; label?: string }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const alive = useRef(true);
  const [state, setState] = useState("idle");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
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
        source.getTracks().forEach((track) => track.stop());
        if (!alive.current) return;
        setState("reading");
        try {
          const wav = await blobToWav16k(new Blob(chunks, { type: capture.mimeType }));
          const body = new FormData();
          body.append("audio", new Blob([wav.bytes as unknown as BlobPart], { type: "audio/wav" }), "voice.wav");
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
      setState("recording");
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      setState("error");
    }
  }
  return <>
    <Button variant="secondary" disabled={state === "reading" || state === "starting"} onClick={() => state === "recording" ? recorder.current?.stop() : void start()}>
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
        <ScanRecipeButton onScanned={(result) => { setPhoto(result); setPreview(result.prefill); }} />
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = <K extends keyof KitchenPreferences>(key: K, value: KitchenPreferences[K]) => setPrefs((previous) => ({ ...previous, [key]: value }));
  async function suggest() {
    setBusy(true);
    setError("");
    const response = await postJson<{ draft: Draft }>("/api/kitchen", { action: "surprise", prefs, previous: draft?.title });
    invalidateJson(["/api/kitchen?prefs=1"]);
    setBusy(false);
    if (response?.draft) setDraft(response.draft);
    else setError("Couldn’t find a recipe just now. Try again.");
  }
  async function keep() {
    if (!draft) return;
    setBusy(true);
    setError("");
    const response = await postJson<{ recipe: { id: string } }>("/api/kitchen", { ...draft, action: "create", museIdea: true });
    setBusy(false);
    if (response?.recipe) onSaved(response.recipe.id);
    else setError("Couldn’t save the recipe. Try again.");
  }
  return <div className="space-y-3">
    {draft ? <>
      <RecipeCover recipe={{ title: draft.title, course: draft.course ?? "main" }} className="h-32 rounded-xl" />
      <h3 className="text-title">{draft.title}</h3>
      <p className="text-body">Serves {draft.serves}{draft.caloriesPerServing ? ` · about ${draft.caloriesPerServing} kcal per serving` : ""}</p>
      <ul>{draft.ingredients.map((ingredient, index) => <li key={index}>{ingredient.item} · {ingredient.said}</li>)}</ul>
      <ol>{draft.steps.map((step, index) => <li key={index}>{step.text}</li>)}</ol>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void keep()}>Keep it</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void suggest()}>Another</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setDraft(null)}>Change preferences</Button>
      </div>
    </> : <>
      <label className="block">What’s in your fridge? <textarea className={field} maxLength={600} value={prefs.fridge} onChange={(event) => update("fridge", event.target.value)} /></label>
      <RecipeMic label="Tell us what you have" onText={(value) => update("fridge", value.slice(0, 600))} />
      <div role="group" aria-label="Taste" className="flex flex-wrap gap-2">
        {["Mild", "Spicy", "Sweet", "Savoury"].map((taste) => (
          <Button key={taste} variant={prefs.taste === taste ? "primary" : "secondary"} aria-pressed={prefs.taste === taste} onClick={() => update("taste", prefs.taste === taste ? "" : taste)}>{taste}</Button>
        ))}
      </div>
      <label className="block">Diet <input className={field} maxLength={120} placeholder="Vegetarian, gluten-free…" value={prefs.diet} onChange={(event) => update("diet", event.target.value)} /></label>
      <label className="block">Calories per serving (optional) <input className={field} type="number" min={1} max={10000} value={prefs.calories ?? ""} onChange={(event) => update("calories", event.target.valueAsNumber || null)} /></label>
      <label className="block">Minutes available <input className={field} type="number" min={1} max={1440} value={prefs.minutes || ""} onChange={(event) => update("minutes", event.target.valueAsNumber || 0)} /></label>
      <label className="block">Servings <input className={field} type="number" min={1} max={60} value={prefs.servings || ""} onChange={(event) => update("servings", event.target.valueAsNumber || 0)} /></label>
      <Button disabled={busy || prefs.minutes < 1 || prefs.minutes > 1440 || prefs.servings < 1 || prefs.servings > 60} onClick={() => void suggest()}>{busy ? "Thinking…" : "Find a recipe"}</Button>
    </>}
    <p className="text-callout text-ink-soft">Nutrition figures are estimates. For medical advice, ask a qualified professional.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
