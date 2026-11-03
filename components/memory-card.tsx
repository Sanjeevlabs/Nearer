"use client";

import { callName, cardCover, cardDuration, formatDuration, relativeDay, tintShadow } from "@/lib/people";
import type { Card } from "@/lib/schemas";
import { useDisplayText } from "@/lib/use-display-text";
import { cn } from "@/lib/utils";
import { usePlayer } from "./player";
import { canChange } from "@/lib/permissions";
import { resetFamilyCards } from "@/lib/use-family";
import { useState } from "react";
import { useShell } from "./shell";
import { PrintFrame } from "./print-frame";
import { ActionMenu, Button, Icon, LiveDot, Photo } from "./ui/kit";
import { useViewer } from "./viewer";
import { museLabel } from "@/lib/muse-portrait";
import { privateLabel } from "@/lib/card-privacy";
import { printWhen } from "@/lib/print";

/**
 * Edit the caption or delete a voice note / photo. The author can do both;
 * an admin can delete (moderation). Everyone else sees no menu at all.
 */
export function CardActions({ card, tone = "soft", onEditing }: { card: Card; tone?: "soft" | "light"; onEditing?: (editing: boolean) => void }) {
  const { viewer } = useViewer();
  const { bumpRefresh } = useShell();
  const actions = [];
  if (canChange(viewer, card.authorId, "edit")) actions.push({ label: card.type === "audio" ? "Edit the words" : "Edit caption", onSelect: () => onEditing?.(true) });
  if (canChange(viewer, card.authorId, "delete"))
    actions.push({
      label: card.type === "audio" ? "Delete voice memory" : "Delete",
      danger: true,
      confirm: card.authorId === viewer.id ? "Delete it for everyone? Reactions and replies to it go too." : "Remove this for everyone? (admin)",
      onSelect: async () => {
        await fetch(`/api/cards/${encodeURIComponent(card.id)}`, { method: "DELETE" });
        resetFamilyCards();
        bumpRefresh();
      },
    });
  return <ActionMenu actions={actions} tone={tone} label="Voice memory options" />;
}

export function CaptionEditor({ card, onDone }: { card: Card; onDone: () => void }) {
  const { bumpRefresh } = useShell();
  const [value, setValue] = useState(card.transcript || card.caption);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 rounded-[18px] bg-surface p-3">
      <textarea value={value} onChange={(e) => setValue(e.target.value)} maxLength={280} rows={3} className="w-full resize-none rounded-[14px] bg-white p-3 text-body outline-none focus:ring-2 focus:ring-marigold" aria-label="Words" />
      <div className="mt-2 flex gap-2">
        <Button
          className="h-11 flex-1 text-body"
          disabled={busy || !value.trim()}
          onClick={async () => {
            setBusy(true);
            await fetch(`/api/cards/${encodeURIComponent(card.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ caption: value.trim() }) });
            resetFamilyCards();
            bumpRefresh();
            setBusy(false);
            onDone();
          }}
        >
          Save
        </Button>
        <Button variant="secondary" className="h-11 flex-1 !bg-surface text-body" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A voice note as a track: album art, who, their words, play. */
export function VoiceRow({ card, showAuthor = true }: { card: Card; showAuthor?: boolean }) {
  const { members, displayLang } = useViewer();
  const { play, current, isPlaying, toggle } = usePlayer();
  const { text } = useDisplayText(card.transcript || card.caption, card.transcript ? card.transcriptLang : card.lang, displayLang);
  const author = members.find((m) => m.id === card.authorId);
  const active = current?.id === card.id;
  const [editing, setEditing] = useState(false);
  return (
    <div className="py-2.5">
    <div className="flex items-center gap-3.5">
      <button
        type="button"
        onClick={() => (active ? toggle() : play(card))}
        aria-label={`Play ${callName(author)}'s voice memory`}
        className="press relative h-14 w-14 shrink-0 overflow-hidden rounded-[16px] bg-surface"
        style={{ boxShadow: tintShadow(card, 0.35) }}
      >
        <Photo src={cardCover(card, members)} alt="" sizes="128px" position="center 30%" />
        <span className="glass absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full">
          <Icon name={active && isPlaying ? "pause" : "play"} size={12} />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="m-0 flex items-center gap-1.5 text-footnote text-ink-soft">
          {active && isPlaying && <LiveDot />}
          {showAuthor ? `${callName(author)} · ` : ""}
          {relativeDay(card.takenAt)}
        </p>
        <p className="voice m-0 line-clamp-2 text-headline leading-snug text-ink">{text ?? "…"}</p>
      </div>
      <span className="tnum shrink-0 text-footnote text-ink-faint">{formatDuration(cardDuration(card))}</span>
      <CardActions card={card} onEditing={setEditing} />
    </div>
    {editing && <CaptionEditor card={card} onDone={() => setEditing(false)} />}
    </div>
  );
}

/**
 * A photo as a print (white border; the note, when and where in the sharer's
 * hand). A video keeps the full-bleed card with a glass caption.
 */
export function PhotoCard({ card, tall = false }: { card: Card; tall?: boolean }) {
  const { members, viewer, displayLang } = useViewer();
  const { text, translated } = useDisplayText(card.caption, card.lang, displayLang);
  const author = members.find((m) => m.id === card.authorId);
  const [editing, setEditing] = useState(false);
  if (card.type === "photo") {
    return (
      <div>
        <PrintFrame card={card} author={author} src={cardCover(card, members)} alt={text ?? "Family photo"} imageHeight={tall ? 380 : 280} signed>
          {card.source === "glasses" && <span className="glass absolute left-2.5 top-2.5 rounded-full px-3 py-1.5 text-caption font-medium">Captured hands-free</span>}
          {museLabel(card.source) && <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-white/90 px-3 py-1.5 text-caption font-semibold text-[#1c1b1a]"><Icon name="sparkle" size={12} />{museLabel(card.source)}</span>}
          <div className="glass absolute right-2.5 top-2.5 rounded-full">
            <CardActions card={card} tone="light" onEditing={setEditing} />
          </div>
        </PrintFrame>
        <p data-ui="photo-details" className="tnum m-0 mt-2 px-1 text-footnote text-ink-soft">
          {[author ? `Shared by ${callName(author)}` : "", printWhen(card.takenAt, author?.tz) && `taken ${printWhen(card.takenAt, author?.tz)}`, privateLabel(card, viewer.id, members)].filter(Boolean).join(" · ")}
        </p>
        {editing && <CaptionEditor card={card} onDone={() => setEditing(false)} />}
      </div>
    );
  }
  return (
    <div>
    <figure className={cn("relative m-0 overflow-hidden rounded-card bg-surface", tall ? "h-[420px]" : "h-[300px]")} style={{ boxShadow: tintShadow(card, 0.45) }}>
      <Photo src={cardCover(card, members)} alt={text ?? "Family photo"} sizes="(max-width: 480px) 100vw, 440px" />
      {card.type === "video" && (
        <span className="glass absolute left-3 top-3 grid h-10 w-10 place-items-center rounded-full">
          <Icon name="play" size={16} />
        </span>
      )}
      {card.source === "glasses" && <span className="glass absolute right-14 top-3 rounded-full px-3 py-1.5 text-caption font-medium">Captured hands-free</span>}
      <div className="glass absolute right-2.5 top-2.5 rounded-full">
        <CardActions card={card} tone="light" onEditing={setEditing} />
      </div>
      <figcaption className="glass absolute inset-x-2.5 bottom-2.5 rounded-[18px] px-4 py-3">
        <p className="m-0 text-footnote text-white/80">
          {callName(author)} · {relativeDay(card.takenAt)}
          {translated ? " · translated" : ""}
        </p>
        <p className="m-0 text-headline font-semibold leading-snug">{text || "Untitled moment"}</p>
      </figcaption>
    </figure>
    {editing && <CaptionEditor card={card} onDone={() => setEditing(false)} />}
    </div>
  );
}

