"use client";

import { useEffect, useState } from "react";
import { canvasBlob, fileToDataUrl, markResult, restoreSample, sizeFor } from "@/lib/muse-canvas";
import { RESTORE_MARK } from "@/lib/muse-portrait";
import { Button, Icon } from "./ui/kit";

// "Old photo? Let Muse restore it": the one Muse offer in the add sheet, shown
// only for a single photo. Muse cleans scratches and fading and keeps every
// face as it is; the person sees both side by side and keeps one. The
// original is never replaced on its own.

export interface Restored {
  runId: string;
  blob: Blob;
}

type State = { at: "offer" } | { at: "working" } | { at: "preview"; runId: string; url: string; blob: Blob; sample: boolean } | { at: "kept"; url: string } | { at: "declined" };

export function RestoreOffer({ file, onChange }: { file: File; onChange: (r: Restored | null) => void }) {
  const [state, setState] = useState<State>({ at: "offer" });
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setOriginal(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const restore = async () => {
    setError(null);
    setState({ at: "working" });
    try {
      const { dataUrl, w, h } = await fileToDataUrl(file);
      const res = await fetch("/api/muse/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: dataUrl, size: sizeFor(w, h) }) });
      const out = (await res.json().catch(() => ({}))) as { runId?: string; image?: string; sample?: boolean; error?: string };
      if (!res.ok || !out.runId) throw new Error(out.error ?? "failed");
      const canvas = out.image ? await markResult(out.image, RESTORE_MARK) : await restoreSample(dataUrl, RESTORE_MARK);
      const blob = await canvasBlob(canvas);
      setState({ at: "preview", runId: out.runId, url: URL.createObjectURL(blob), blob, sample: Boolean(out.sample) });
    } catch (e) {
      setError((e as Error).message === "daily-limit" ? "That's today's restores for your family. Try again tomorrow." : "Muse couldn't restore this one. Your photo is unchanged.");
      setState({ at: "offer" });
    }
  };

  if (state.at === "declined") return null;

  if (state.at === "kept") {
    return (
      <div className="mt-3 flex items-center gap-3 rounded-[18px] bg-surface px-3 py-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={state.url} alt="" className="h-11 w-11 rounded-[10px] object-cover" />
        <span className="min-w-0 flex-1 text-callout">
          <span className="block font-semibold">Restored by Muse</span>
          <span className="block text-caption text-ink-soft">The original is kept with it.</span>
        </span>
        <button type="button" className="press h-11 px-2 text-callout font-medium text-ink-soft" onClick={() => { onChange(null); setState({ at: "offer" }); }}>
          Undo
        </button>
      </div>
    );
  }

  if (state.at === "preview") {
    return (
      <div className="mt-3 rounded-[22px] border border-[var(--line)] p-3" aria-label="Restored photo preview">
        <div className="grid grid-cols-2 gap-2">
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={original ?? ""} alt="Your original photo" className="aspect-[4/5] w-full rounded-[14px] bg-surface object-contain" />
            <figcaption className="mt-1 text-center text-caption text-ink-soft">Original</figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={state.url} alt="The photo restored by Muse" className="aspect-[4/5] w-full rounded-[14px] bg-surface object-contain" />
            <figcaption className="mt-1 text-center text-caption text-ink-soft">{state.sample ? "Sample: Muse is off" : "Restored by Muse"}</figcaption>
          </figure>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" className="h-12 flex-1 px-3 text-body" onClick={() => { onChange(null); setState({ at: "declined" }); }}>
            Keep original
          </Button>
          <Button className="h-12 flex-1 px-3 text-body" onClick={() => { onChange({ runId: state.runId, blob: state.blob }); setState({ at: "kept", url: state.url }); }}>
            Keep restored
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex items-center rounded-[18px] bg-surface pr-1">
        <button type="button" onClick={() => void restore()} disabled={state.at === "working"} className="press flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left disabled:opacity-60">
          <Icon name="sparkle" size={20} />
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold">{state.at === "working" ? "Restoring…" : "Old photo? Let Muse restore it"}</span>
            <span className="block text-caption text-ink-soft">Scratches and fading, gently. Faces stay as they are.</span>
          </span>
        </button>
        {state.at !== "working" && (
          <button type="button" aria-label="Not now" onClick={() => setState({ at: "declined" })} className="press grid h-11 w-11 shrink-0 place-items-center text-ink-faint">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {error && <p className="m-0 mt-2 text-footnote text-[#b42318]" role="alert">{error}</p>}
    </div>
  );
}
