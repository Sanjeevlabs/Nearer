"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { BottomSheet, SharePanel, type ShareTarget } from "./share-panel";
import { StickerMaker, type StickerSpec } from "./sticker-maker";
import { Icon } from "./ui/kit";

// One share sheet for everything that leaves the family (see share-panel.tsx
// for how an image is handed over). "Make a sticker" sits next to Share
// wherever the thing can also become a sticker.

export type { ShareTarget } from "./share-panel";
export { deliverImage } from "./share-panel";

export function ShareSheet({ open, onClose, target, sticker }: { open: boolean; onClose: () => void; target: ShareTarget; sticker?: StickerSpec | null }) {
  const [making, setMaking] = useState(false);
  return (
    <>
      <BottomSheet open={open && !making} onClose={onClose} title={target.title}>
        {target.note && <p className="m-0 mb-3 text-callout text-ink-soft">{target.note}</p>}
                <SharePanel target={target} lead={sticker ? { label: "Make a sticker", icon: "sticker", onClick: () => setMaking(true) } : undefined} />
      </BottomSheet>
      {sticker && (
        <StickerMaker
          open={open && making}
          spec={sticker}
          onClose={() => {
            setMaking(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

/** A Share button that opens the sheet. `target` is built only when opened. */
export function ShareButton({
  target,
  sticker,
  label = "Share",
  tone = "soft",
  className,
  iconOnly = false,
  onOpenChange,
}: {
  target: () => ShareTarget;
  sticker?: () => StickerSpec | null;
  label?: string;
  tone?: "soft" | "dark" | "glass" | "paper";
  className?: string;
  iconOnly?: boolean;
  /** E.g. pause a slideshow while the sheet is open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };
  const [built, setBuilt] = useState<{ t: ShareTarget; s: StickerSpec | null } | null>(null);
  const tones = {
    soft: "bg-surface text-ink",
    dark: "bg-black text-white",
    glass: "bg-white/20 text-white backdrop-blur",
    paper: "bg-black/[.05] text-[#4a413a]",
  } as const;
  return (
    <>
      <button
        type="button"
        aria-label={iconOnly ? label : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setBuilt({ t: target(), s: sticker?.() ?? null });
          setOpen(true);
        }}
        className={cn("press flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full text-body font-semibold", iconOnly ? "w-11" : "px-4", tones[tone], className)}
      >
        <Icon name="share" size={iconOnly ? 18 : 16} />
        {!iconOnly && label}
      </button>
      {built && <ShareSheet open={open} onClose={() => setOpen(false)} target={built.t} sticker={built.s} />}
    </>
  );
}
