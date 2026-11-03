"use client";

import { useRef, useState } from "react";
import { processImage } from "@/lib/media-client";
import { fileToDataUrl } from "@/lib/muse-canvas";
import type { Draft, ScanInfo } from "./recipe-editor";
import { Icon } from "./ui/kit";

// "Scan a recipe card": the Kitchen's one Muse offer. A photo of a handwritten
// or printed card (any language) → a draft in the recipe editor for a person
// to check. The photo is kept on the recipe; if Muse can't read it, the
// editor opens empty with the photo attached.

export interface ScanResult {
  prefill: Partial<Draft>;
  scan: ScanInfo;
}

export function ScanRecipeButton({ onScanned }: { onScanned: (r: ScanResult) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = async (file: File) => {
    setError(null);
    const preview = URL.createObjectURL(file);
    setBusy(preview);
    try {
      const upload = await processImage(file, { fromToday: false, fromGlassesToggle: false });
      const { dataUrl } = await fileToDataUrl(file, 2000);
      const res = await fetch("/api/kitchen/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
      const out = res.ok ? ((await res.json()) as { draft: Partial<Draft> | null; source: "muse" | "fallback" }) : { draft: null, source: "fallback" as const };
      const draft = out.draft;
      onScanned({
        prefill: draft
          ? {
              title: draft.title ?? "",
              course: draft.course ?? "main",
              serves: draft.serves ?? "",
              prepMins: draft.prepMins ?? null,
              cookMins: draft.cookMins ?? null,
              caloriesPerServing: draft.caloriesPerServing ?? null,
              prepWork: draft.prepWork ?? [],
              outcome: draft.outcome ?? "",
              ingredients: draft.ingredients?.length ? draft.ingredients : [{ item: "", said: "", approx: "" }],
              steps: draft.steps?.length ? draft.steps : [{ text: "", tip: "" }],
            }
          : {},
        scan: { ref: upload.mediaRef, url: upload.previewUrl ?? preview, fromMuse: Boolean(draft) },
      });
    } catch {
      setError("Couldn't read that photo. Try a clearer one, in good light.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Photo of a recipe card"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void read(f);
        }}
      />
      <button type="button" disabled={Boolean(busy)} onClick={() => inputRef.current?.click()} className="press flex w-full items-center gap-3 rounded-[20px] border border-[var(--line)] px-3.5 py-3 text-left disabled:opacity-70">
        {busy ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={busy} alt="" className="h-10 w-10 shrink-0 animate-pulse rounded-[10px] object-cover" />
        ) : (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-well text-ink-soft">
            <Icon name="camera" size={20} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold">{busy ? "Reading the card…" : "Add a photo"}</span>
          <span className="block text-caption text-ink-soft">Handwritten or printed, any language. You check it before it&rsquo;s saved.</span>
        </span>
      </button>
      {error && <p className="m-0 mt-2 text-footnote text-[#b42318]" role="alert">{error}</p>}
    </div>
  );
}
