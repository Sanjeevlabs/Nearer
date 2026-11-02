"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { slug } from "@/lib/card-kit";
import { blessingSticker, clampWords, lampSticker, photoSticker, plateSticker, transcriptWords, treeBadge, type CropShape, type Point } from "@/lib/stickers";
import { cn } from "@/lib/utils";
import { BottomSheet, SharePanel, type ShareTarget } from "./share-panel";
import { Icon } from "./ui/kit";

// Make a sticker from something in the family: a person or a dish cut out of
// your own photo (SAM when the server has it, otherwise a clean circle), a
// recipe with its name handwritten, an elder's few words, the family's faces
// around its name, or the lit lamp. 512×512 transparent PNG with a white
// die-cut edge; it leaves through the same share sheet as everything else.

export type StickerSpec =
  | { kind: "photo"; title: string; src: string; source: { kind: "card" | "recipe"; id: string }; label?: string }
  | { kind: "recipe"; title: string; src: string | null; source: { kind: "recipe"; id: string }; label: string }
  | { kind: "blessing"; title: string; transcript: string; by: string }
  | { kind: "tree"; title: string; familyName: string; faces: { name: string; photo: string | null }[] }
  | { kind: "lamp"; title: string; text?: string };

/** Downscale a photo to a JPEG (≤1024 px) for the cut-out route. */
async function photoForCutout(src: string): Promise<string | null> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const i = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:")) i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });
  if (!img) return null;
  const s = Math.min(1, 1024 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  try {
    return c.toDataURL("image/jpeg", 0.86);
  } catch {
    return null;
  }
}

let samAvailable: Promise<boolean> | null = null;
function cutoutAvailable(): Promise<boolean> {
  samAvailable ??= fetch("/api/stickers/cutout", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ available: boolean }>) : { available: false }))
    .then((j) => Boolean(j.available))
    .catch(() => false);
  return samAvailable;
}

function PhotoPicker({ src, at, onPick }: { src: string; at: Point; onPick: (p: Point) => void }) {
  const ref = useRef<HTMLImageElement>(null);
  return (
    <div className="relative mx-auto w-fit overflow-hidden rounded-[18px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={ref}
        src={src}
        alt="Tap who or what to cut out"
        className="block max-h-[30dvh] w-auto max-w-full cursor-crosshair select-none"
        draggable={false}
        onClick={(e) => {
          const r = ref.current?.getBoundingClientRect();
          if (!r) return;
          onPick({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
        }}
      />
      <span className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-black/30 shadow-[0_0_0_2px_rgba(0,0,0,.35)]" style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }} aria-hidden="true" />
    </div>
  );
}

export function StickerMaker({ open, onClose, spec }: { open: boolean; onClose: () => void; spec: StickerSpec }) {
  const photoSrc = spec.kind === "photo" || spec.kind === "recipe" ? spec.src : null;
  const [at, setAt] = useState<Point>({ x: 0.5, y: 0.4 });
  const [shape, setShape] = useState<CropShape>("circle");
  const [label, setLabel] = useState(spec.kind === "photo" ? (spec.label ?? "") : spec.kind === "recipe" ? spec.label : spec.kind === "lamp" ? (spec.text ?? "Thinking of you") : "");
  const words = useMemo(() => (spec.kind === "blessing" ? transcriptWords(spec.transcript) : []), [spec]);
  // Blessing: the first few words to start with; the person picks or types the rest.
  const [picked, setPicked] = useState<number[]>(() => words.slice(0, 6).map((_, i) => i));
  const [blessing, setBlessing] = useState(() => clampWords(words.slice(0, 6).join(" ")));
  const [sam, setSam] = useState(false);
  const [mask, setMask] = useState<Blob | null>(null);
  const [cutting, setCutting] = useState(false);
  const [cutNote, setCutNote] = useState<string | null>(null);

  useEffect(() => {
    if (open && photoSrc) void cutoutAvailable().then(setSam);
  }, [open, photoSrc]);


  const cutOut = useCallback(
    async (p: Point) => {
      if ((spec.kind !== "photo" && spec.kind !== "recipe") || !spec.src || !sam) return;
      setCutting(true);
      setCutNote(null);
      try {
        const image = await photoForCutout(spec.src);
        if (!image) throw new Error("unreadable");
        const res = await fetch("/api/stickers/cutout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: spec.source, image, point: p }) });
        if (res.ok && res.headers.get("content-type")?.includes("image/png")) setMask(await res.blob());
        else {
          setMask(null);
          setCutNote(res.status === 429 ? "Lots of cut-outs just now. Here’s a circle instead." : "Couldn’t cut it out. Here’s a circle instead.");
        }
      } catch {
        setMask(null);
        setCutNote("Couldn’t cut it out. Here’s a circle instead.");
      } finally {
        setCutting(false);
      }
    },
    [spec, sam],
  );

  const text = spec.kind === "blessing" ? clampWords(blessing) : label.trim().slice(0, 40);
  const renderKey = JSON.stringify([at, shape, text, mask ? mask.size : 0]);

  const target: ShareTarget = {
    title: spec.title,
    filename: `${slug(spec.kind === "blessing" ? `${spec.by} ${text}` : spec.kind === "tree" ? `${spec.familyName} family` : text || spec.title)}-sticker.png`,
    text: "",
    transparent: true,
    render: async () => {
      switch (spec.kind) {
        case "photo":
          return photoSticker({ src: spec.src, at, mask, shape, label: text });
        case "recipe":
          return spec.src ? photoSticker({ src: spec.src, at, mask, shape, label: text }) : plateSticker(text);
        case "blessing":
          return text ? blessingSticker({ words: text, by: spec.by }) : null;
        case "tree":
          return treeBadge({ familyName: spec.familyName, faces: spec.faces });
        case "lamp":
          return lampSticker({ text });
      }
    },
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={spec.title} z={85}>
      <p className="m-0 mb-3 text-callout text-ink-soft">A sticker for any chat. It stays on your phone until you share it.</p>

      {photoSrc && (
        <div className="mb-3">
          <PhotoPicker
            src={photoSrc}
            at={at}
            onPick={(p) => {
              setAt(p);
              setMask(null);
              void cutOut(p);
            }}
          />
          <p className="m-0 mt-2 text-center text-footnote text-ink-soft">{cutting ? "Cutting out…" : (cutNote ?? (sam ? "Tap a person or the dish to cut it out." : "Tap where the sticker should centre."))}</p>
          {!mask && (
            <div className="mt-2 flex justify-center gap-1.5" role="radiogroup" aria-label="Shape">
              {(["circle", "rounded"] as const).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={shape === s} onClick={() => setShape(s)} className={cn("press h-10 rounded-full px-4 text-callout font-semibold", shape === s ? "bg-accent text-accent-ink" : "bg-surface")}>
                  {s === "circle" ? "Circle" : "Rounded"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {(spec.kind === "photo" || spec.kind === "recipe" || spec.kind === "lamp") && (
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 40))}
          placeholder={spec.kind === "photo" ? "Add a few words (optional)" : "Words on the sticker"}
          aria-label="Words on the sticker"
          className="mb-3 h-12 w-full rounded-full bg-surface px-5 font-hand text-title outline-none focus:ring-2 focus:ring-marigold"
        />
      )}

      {spec.kind === "blessing" && (
        <div className="mb-3">
          {words.length > 0 && (
            <>
              <p className="m-0 mb-1.5 text-footnote font-medium text-ink-soft">Tap up to 6 words from what {spec.by} said</p>
              <div className="no-scrollbar flex max-h-[120px] flex-wrap gap-1.5 overflow-y-auto">
                {words.map((w, i) => {
                  const on = picked.includes(i);
                  return (
                    <button
                      key={`${w}-${i}`}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = on ? picked.filter((x) => x !== i) : [...picked, i].sort((a, b) => a - b).slice(0, 6);
                        setPicked(next);
                        setBlessing(next.map((n) => words[n]).join(" "));
                      }}
                      className={cn("press h-9 rounded-full px-3 font-hand text-headline", on ? "bg-[#7a2e0e] text-white" : "bg-surface")}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <input value={blessing} onChange={(e) => e.target.value.trim().split(/\s+/).filter(Boolean).length <= 6 && setBlessing(e.target.value.slice(0, 60))} aria-label="The words on the sticker (up to 6)" className="mt-2 h-12 w-full rounded-full bg-surface px-5 font-hand text-title outline-none focus:ring-2 focus:ring-marigold" />
          <p className="m-0 mt-1 px-2 text-caption text-ink-faint">Up to 6 words. Only the words go on the sticker, never the voice.</p>
        </div>
      )}

      <SharePanel target={target} renderKey={renderKey} />
      <button type="button" onClick={onClose} className="press mt-3 flex h-11 w-full items-center justify-center gap-1.5 text-body font-semibold text-ink-soft">
        <Icon name="close" size={16} /> Done
      </button>
    </BottomSheet>
  );
}

/** "Make a sticker" on its own, for things that have no share card (the lamp). */
export function StickerButton({ spec, label = "Make a sticker", className, iconOnly = false }: { spec: () => StickerSpec; label?: string; className?: string; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [built, setBuilt] = useState<StickerSpec | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={iconOnly ? label : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setBuilt(spec());
          setOpen(true);
        }}
        className={cn("press flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full text-callout font-semibold", iconOnly ? "w-10" : "px-3.5", className)}
      >
        <Icon name="sticker" size={17} />
        {!iconOnly && label}
      </button>
      {built && <StickerMaker open={open} spec={built} onClose={() => setOpen(false)} />}
    </>
  );
}
