"use client";

import { AnimatePresence, m } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isNative, share as nativeShare } from "@/lib/native";
import { downloadBlob } from "@/lib/poster";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./ui/kit";

// The share sheet's parts (components/share-sheet.tsx puts them together).
// One share sheet for everything that leaves the family: a rendered image
// (and, for recipes only, a public link). "Share" hands the PNG to the
// system share sheet when the device can share files; in the app it uses the
// native sheet; otherwise it saves the image (and copies the link). Voices
// never leave: only images and frozen text copies do. Nothing is counted.

export interface ShareTarget {
  /** Sheet heading ("Share this print"). */
  title: string;
  /** One calm line on what others will see. */
  note?: string;
  filename: string;
  /** Words that travel with the image. */
  text: string;
  /** Draw the PNG; `link` is the public link when there is one. */
  render: (link: string | null) => Promise<Blob | null>;
  /** Only recipes have one: the link already made, or how to make it. */
  link?: { existing: string | null; make: () => Promise<string | null> } | null;
  /** Further rows under the main actions (WhatsApp, copy as text…). */
  extra?: { key: string; label: string; sub?: string; icon?: IconName; onClick: () => Promise<string | void> }[];
  footer?: ReactNode;
  /** Stickers: preview on a checkerboard so the transparency shows. */
  transparent?: boolean;
}

export type Delivered = "shared" | "saved" | "cancelled";

/** Hand a PNG (plus words and maybe a link) to the best share route this device has. */
export async function deliverImage(blob: Blob, filename: string, text: string, url: string | null): Promise<Delivered> {
  const body = url ? `${text}\n${url}` : text;
  const file = new File([blob], filename, { type: blob.type || "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text: body });
      return "shared";
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return "cancelled";
    }
  }
  if (isNative()) {
    // The native sheet takes words and a link; the image is saved alongside.
    downloadBlob(blob, filename);
    return (await nativeShare({ title: text.slice(0, 80), text, url: url ?? undefined })) ? "shared" : "saved";
  }
  downloadBlob(blob, filename);
  if (url) await navigator.clipboard?.writeText(url).catch(() => undefined);
  return "saved";
}

/** A calm bottom sheet over everything (portalled, so transformed parents can't trap it). */
export function BottomSheet({ open, onClose, label, children, z = 80 }: { open: boolean; onClose: () => void; label: string; children: ReactNode; z?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 flex items-end justify-center text-ink" style={{ zIndex: z }} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
          <m.button type="button" aria-label="Close" className="absolute inset-0 bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <m.div
            className="relative max-h-[94dvh] w-full max-w-[480px] overflow-y-auto rounded-t-[32px] bg-paper px-4 pt-3 shadow-frost"
            style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36 }}
          >
            <span className="mx-auto mb-3 block h-1.5 w-10 rounded-full bg-black/15" aria-hidden="true" />
            {children}
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const CHECKER = "repeating-conic-gradient(#ececec 0% 25%, #fafafa 0% 50%) 50% / 20px 20px";

/** The preview and the actions: Share, Save image, Copy link (when there is one), and any extras. */
export function SharePanel({ target, renderKey = 0, lead }: { target: ShareTarget; renderKey?: number | string; lead?: { label: string; icon: IconName; onClick: () => void } }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(target.link?.existing ?? null);
  const renderRef = useRef(target.render);
  renderRef.current = target.render;

  useEffect(() => {
    let live = true;
    setBlob(null);
    setFailed(false);
    void renderRef.current(link).then(
      (b) => {
        if (!live) return;
        if (b) setBlob(b);
        else setFailed(true);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [renderKey, link]);

  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setNote(null);
    try {
      const msg = await fn();
      if (msg) setNote(msg);
    } finally {
      setBusy(null);
    }
  };

  const ensureLink = async (): Promise<string | null> => {
    if (link) return link;
    const made = (await target.link?.make()) ?? null;
    if (made) setLink(made);
    return made;
  };

  const doShare = async () => {
    let b = blob;
    let u: string | null = link;
    if (target.link) {
      u = await ensureLink();
      if (u && u !== link) b = await target.render(u);
    }
    if (!b) return "Couldn’t draw the image. Try again.";
    const how = await deliverImage(b, target.filename, target.text, u);
    if (how === "saved") return u ? "Image saved, link copied." : "Saved to your device.";
  };

  const actions: { key: string; label: string; icon: IconName; onClick: () => Promise<string | void>; show: boolean }[] = [
    { key: "share", label: "Share", icon: "share", onClick: doShare, show: true },
    {
      key: "save",
      label: "Save image",
      icon: "download",
      show: true,
      onClick: async () => {
        if (!blob) return "Still drawing…";
        downloadBlob(blob, target.filename);
        return "Saved to your device.";
      },
    },
    {
      key: "link",
      label: "Copy link",
      icon: "link",
      show: Boolean(target.link),
      onClick: async () => {
        const u = await ensureLink();
        if (!u) return "Couldn’t make a link. Try again.";
        await navigator.clipboard?.writeText(u).catch(() => undefined);
        return "Link copied.";
      },
    },
  ];
  const shown = actions.filter((a) => a.show);
  const cols = shown.length + (lead ? 1 : 0);

  return (
    <div>
      <div className="flex justify-center">
        <div className={cn("relative flex min-h-[180px] w-full items-center justify-center overflow-hidden rounded-[22px]", target.transparent ? "max-h-[32dvh]" : "max-h-[44dvh]")} style={{ background: target.transparent ? CHECKER : "var(--surface)" }}>
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="What will be shared" className={cn("block w-auto max-w-full object-contain", target.transparent ? "max-h-[32dvh]" : "max-h-[44dvh] shadow-[0_8px_24px_rgba(0,0,0,.18)]")} />
          ) : failed ? (
            <p className="m-0 px-6 py-10 text-center text-body text-ink-soft">Couldn&rsquo;t draw this one. The photo may still be loading; try again in a moment.</p>
          ) : (
            <div className="skeleton h-[260px] w-[208px] rounded-[14px]" aria-busy="true" aria-label="Drawing the image" />
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {shown.map((a, i) => (
          <button
            key={a.key}
            type="button"
            disabled={Boolean(busy) || (!blob && a.key !== "link")}
            onClick={() => void run(a.key, a.onClick)}
            className={cn("press flex h-16 flex-col items-center justify-center gap-1.5 rounded-[20px] text-callout font-semibold disabled:opacity-50", i === 0 ? "bg-black text-white" : "bg-surface text-ink")}
          >
            <Icon name={a.icon} size={22} />
            {busy === a.key ? "One moment…" : a.label}
          </button>
        ))}
        {lead && (
          <button type="button" disabled={Boolean(busy)} onClick={lead.onClick} className="press flex h-16 flex-col items-center justify-center gap-1.5 rounded-[20px] bg-[#fff1d6] text-callout font-semibold text-[#7a3d00] disabled:opacity-50">
            <Icon name={lead.icon} size={22} />
            {lead.label}
          </button>
        )}
      </div>
      {target.extra && target.extra.length > 0 && (
        <ul className="m-0 mt-2 list-none space-y-2 p-0">
          {target.extra.map((a) => (
            <li key={a.key}>
              <button type="button" disabled={Boolean(busy)} onClick={() => void run(a.key, a.onClick)} className="press flex min-h-[56px] w-full items-center gap-3 rounded-[18px] bg-surface px-4 py-2.5 text-left disabled:opacity-60">
                {a.icon && <Icon name={a.icon} size={20} className="text-ink-soft" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold">{busy === a.key ? "One moment…" : a.label}</span>
                  {a.sub && <span className="block text-footnote text-ink-soft">{a.sub}</span>}
                </span>
                <Icon name="chevron" size={18} className="text-ink-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="m-0 mt-3 text-center text-callout text-[#3d6b2a]" role="status">
          {note}
        </p>
      )}
      {target.footer}
    </div>
  );
}

