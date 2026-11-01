"use client";

import { AnimatePresence, m } from "framer-motion";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EVENT_LABEL, albumDates, cardImage } from "@/components/albums";
import { useShell } from "@/components/shell";
import { ActionMenu, Button, EmptyLine, Icon, MuseMark, Photo, RoomHeader } from "@/components/ui/kit";
import { EVENT_KINDS } from "@/lib/kind-values";
import type { Album } from "@/lib/kinds";
import type { Card } from "@/lib/schemas";
import { useFamilyCards } from "@/lib/use-family";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";

// One album: a grid like Google Photos, a slideshow like Apple Memories, and
// easy fixes (rename, cover, remove, move, merge). People's fixes always win.

export default function AlbumPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // Opened from Occasions (?from=rituals): leaving goes back there, not to Memory Lane.
  const home = useSearchParams().get("from") === "rituals" ? "/rituals" : "/lane";
  const { refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const { data, reload } = useJson<{ albums: Album[] }>("/api/albums");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Album["event"]>("gathering");
  const [picked, setPicked] = useState<Card | null>(null);
  const [playing, setPlaying] = useState(false);
  const [merging, setMerging] = useState(false);
  const album = data?.albums.find((a) => a.id === id);
  const others = (data?.albums ?? []).filter((a) => a.id !== id);
  const photos = album ? album.cardIds.map((cid) => (cards ?? []).find((c) => c.id === cid)).filter((c): c is Card => Boolean(c)) : [];

  if (!data || !cards) return <div className="skeleton mt-16 h-[420px] rounded-card" aria-busy="true" />;
  if (!album) {
    return (
      <div>
        <RoomHeader title="Album" />
        <EmptyLine>This album isn&rsquo;t here anymore. The photos are still in Memory Lane.</EmptyLine>
      </div>
    );
  }
  const act = async (body: Record<string, unknown>) => {
    const out = await postJson<{ deleted?: string }>("/api/albums", { albumId: album.id, ...body });
    if (out?.deleted) router.replace(home);
    else await reload();
  };

  return (
    <div>
      <RoomHeader
        title=""
        action={
          <ActionMenu
            label="Album options"
            actions={[
              { label: "Rename", onSelect: () => { setTitle(album.title); setKind(album.event); setRenaming(true); } },
              ...(others.length ? [{ label: "Merge into another album", onSelect: () => setMerging(true) }] : []),
              { label: "Delete album", danger: true, confirm: "Delete the album? The photos stay in Memory Lane.", onSelect: () => act({ action: "delete" }) },
            ]}
          />
        }
      />
      <p className="m-0 text-caption font-semibold uppercase tracking-[0.08em] text-ink-soft">{EVENT_LABEL[album.event]}</p>
      <h1 data-display className="m-0 mt-1 text-display leading-tight">{album.title}</h1>
      <p className="m-0 mt-1 text-callout text-ink-soft">
        {albumDates(album)} · {photos.length} {photos.length === 1 ? "photo" : "photos"}
      </p>
      {album.madeBy === "muse" && !album.fixedBy && <MuseMark className="mt-1">sorted and titled by Muse from what&rsquo;s in the photos; rename it anytime</MuseMark>}

      {renaming && (
        <div className="mt-3 space-y-2 rounded-card bg-surface p-3">
          <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} className="h-[48px] w-full rounded-[14px] bg-white px-4 text-body font-semibold outline-none" aria-label="Album name" />
          <div className="flex flex-wrap gap-1.5">
            {EVENT_KINDS.map((e) => (
              <button key={e} type="button" aria-pressed={kind === e} onClick={() => setKind(e)} className={cn("press h-9 rounded-full px-3 text-footnote", kind === e ? "bg-black text-white" : "bg-white")}>
                {EVENT_LABEL[e]}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button className="h-11 flex-1" disabled={!title.trim()} onClick={async () => { await act({ action: "rename", title: title.trim(), event: kind }); setRenaming(false); }}>
              Save
            </Button>
            <Button variant="secondary" className="h-11 flex-1 !bg-white" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {merging && (
        <div className="mt-3 rounded-card bg-surface p-3">
          <p className="m-0 mb-2 text-callout font-medium">Merge into…</p>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {others.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={async () => { await postJson("/api/albums", { action: "merge", albumId: album.id, intoAlbumId: o.id }); router.replace(`/lane/album/${o.id}${home === "/rituals" ? "?from=rituals" : ""}`); }} className="press flex h-11 w-full items-center justify-between rounded-[14px] bg-white px-4 text-left text-body">
                  {o.title}
                  <span className="text-footnote text-ink-faint">{albumDates(o)}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setMerging(false)} className="mt-1 h-10 text-callout font-medium text-ink-soft">
            Cancel
          </button>
        </div>
      )}

      <Button className="mt-4 w-full" disabled={!photos.length} onClick={() => setPlaying(true)}>
        <Icon name="play" size={18} />
        Play
      </Button>

      <ul className="-mx-4 m-0 mt-4 grid list-none grid-cols-3 gap-0.5 p-0">
        {photos.map((c) => {
          const src = cardImage(c);
          return (
            <li key={c.id}>
              <button type="button" onClick={() => setPicked(c)} className="relative block aspect-square w-full overflow-hidden bg-surface" aria-label={c.caption || "Photo"}>
                {src && <Photo src={src} alt="" sizes="160px" />}
                {album.coverId === c.id && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-caption font-semibold text-white">Cover</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <AnimatePresence>
        {picked && (
          <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Photo">
            <m.button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPicked(null)} />
            <m.div className="relative w-full max-w-[480px] rounded-t-[32px] bg-white px-4 pt-4 shadow-frost" style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }} initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 340, damping: 36 }}>
              <div className="relative h-[260px] overflow-hidden rounded-[22px] bg-surface">{cardImage(picked) && <Photo src={cardImage(picked) as string} alt={picked.caption} sizes="440px" />}</div>
              {picked.caption && <p className="m-0 mt-3 text-body">{picked.caption}</p>}
              <div className="mt-3 space-y-2">
                {album.coverId !== picked.id && (
                  <Button variant="secondary" className="w-full" onClick={async () => { await act({ action: "cover", cardId: picked.id }); setPicked(null); }}>
                    Make it the cover
                  </Button>
                )}
                {others.length > 0 && (
                  <select
                    aria-label="Move to album"
                    defaultValue=""
                    onChange={async (e) => {
                      if (!e.target.value) return;
                      await postJson("/api/albums", { action: "move", albumId: album.id, cardId: picked.id, toAlbumId: e.target.value });
                      setPicked(null);
                      await reload();
                    }}
                    className="h-12 w-full rounded-full bg-surface px-5 text-body font-semibold"
                  >
                    <option value="">Move to another album…</option>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                      </option>
                    ))}
                  </select>
                )}
                <Button variant="quiet" className="w-full !text-[#b42318]" onClick={async () => { await act({ action: "remove", cardId: picked.id }); setPicked(null); }}>
                  Not part of this album
                </Button>
              </div>
            </m.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>{playing && <Slideshow photos={photos} title={album.title} onClose={() => setPlaying(false)} />}</AnimatePresence>
    </div>
  );
}

/** Full-screen, slow pan, 4 s a photo; tap to pause, swipe-free on purpose. */
function Slideshow({ photos, title, onClose }: { photos: Card[]; title: string; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => (i < photos.length - 1 ? setI(i + 1) : onClose()), 4000);
    return () => window.clearTimeout(t);
  }, [i, paused, photos.length, onClose]);
  const c = photos[i];
  const src = cardImage(c);
  return (
    <m.div className="fixed inset-0 z-50 bg-black text-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label={`${title}, slideshow`}>
      <button type="button" className="absolute inset-0" aria-label={paused ? "Play" : "Pause"} onClick={() => setPaused((p) => !p)}>
        <AnimatePresence mode="popLayout">
          <m.div key={c.id} className="absolute inset-0" initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1.0 }} exit={{ opacity: 0 }} transition={{ opacity: { duration: 0.8 }, scale: { duration: 4.2, ease: "linear" } }}>
            {src && <Photo src={src} alt={c.caption} sizes="100vw" className="!object-contain" />}
          </m.div>
        </AnimatePresence>
      </button>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex gap-1 px-4" style={{ paddingTop: "calc(12px + env(safe-area-inset-top))" }}>
        {photos.map((p, n) => (
          <span key={p.id} className={cn("h-1 flex-1 rounded-full", n <= i ? "bg-white" : "bg-white/30")} />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.7))] px-4 pb-8 pt-16" style={{ paddingBottom: "calc(28px + env(safe-area-inset-bottom))" }}>
        <p className="m-0 text-footnote text-white/70">{title}</p>
        {c.caption && <p className="m-0 mt-1 text-headline">{c.caption}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close slideshow" className="press absolute right-4 grid h-11 w-11 place-items-center rounded-full bg-white/15" style={{ top: "calc(24px + env(safe-area-inset-top))" }}>
        <Icon name="close" />
      </button>
    </m.div>
  );
}
