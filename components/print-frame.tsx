"use client";

import type { ReactNode } from "react";
import { slug } from "@/lib/card-kit";
import { printNote, printWhen, printWhere } from "@/lib/print";
import { photoPrintCard } from "@/lib/share-cards";
import { canCutOutPhoto, canSharePhoto } from "@/lib/share-rules";
import type { Card, Member } from "@/lib/schemas";
import { useDisplayText } from "@/lib/use-display-text";
import { cn } from "@/lib/utils";
import { ShareButton } from "./share-sheet";
import { Photo } from "./ui/kit";
import { useViewer } from "./viewer";

// A photo shown as a print: a white border, thicker at the bottom like an
// instant photo, a soft shadow and a little paper warmth. In the bottom border,
// in the sharer's hand: the note, then when and where. The print stays paper in
// dark mode too; it's an object, not a surface.

const PAPER = "linear-gradient(180deg, #fffdf8 0%, #f8f3e9 100%)";
const SHADOW = "0 1px 1px rgba(0,0,0,.10), 0 10px 22px rgba(0,0,0,.20), 0 28px 56px rgba(0,0,0,.26)";

export function PrintFrame({
  card,
  author,
  src,
  alt,
  width,
  imageHeight,
  aspect = "4 / 5",
  signed = false,
  priority = false,
  sizes = "(max-width: 480px) 90vw, 400px",
  className,
  children,
  share = false,
  onShareOpen,
}: {
  card: Card;
  author?: Member;
  src: string;
  alt?: string;
  /** CSS width of the whole print (e.g. "min(86vw, 360px)"). Defaults to full width. */
  width?: string;
  /** Fixed image height (cards in a list); otherwise the image keeps `aspect`. */
  imageHeight?: number;
  aspect?: string;
  /** Sign the note with the sharer's name ("— Maa"). */
  signed?: boolean;
  priority?: boolean;
  sizes?: string;
  className?: string;
  /** Drawn over the image (a video, tap zones, a menu). */
  children?: ReactNode;
  /** Offer Share (and Make a sticker) to the person who shared this photo. */
  share?: boolean;
  onShareOpen?: (open: boolean) => void;
}) {
  const { displayLang, viewer } = useViewer();
  const note = printNote(card);
  const { text } = useDisplayText(note, card.lang, displayLang);
  const when = printWhen(card.takenAt, author?.tz);
  const where = printWhere(card, author);
  const by = author ? author.displayName || author.firstName : "";
  const shareable = share && canSharePhoto(viewer, card);
  return (
    <figure
      className={cn("relative m-0 rounded-[3px] p-3 pb-4 text-[#25201c]", className)}
      style={{ width, background: PAPER, boxShadow: SHADOW }}
    >
      <div
        className="relative w-full overflow-hidden bg-[#ebe5d8]"
        style={imageHeight ? { height: imageHeight } : { aspectRatio: aspect }}
      >
        <Photo src={src} alt={alt ?? (note || "Family photo")} sizes={sizes} priority={priority} position="center 30%" />
        {/* the faint edge a real print has where the emulsion meets the paper */}
        <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,.07)]" aria-hidden="true" />
        {children}
      </div>
      {shareable && (
        <div className="absolute bottom-3 right-3 z-20">
          <ShareButton
            iconOnly
            tone="paper"
            label="Share this print"
            onOpenChange={onShareOpen}
            target={() => ({
              title: "Share this print",
              note: "Only you can share your photos. It goes as an image, never a link into the family.",
              filename: `${slug(note || "nearer-print")}.png`,
              text: note,
              render: () => photoPrintCard({ src, note: text ?? note, when, where, by }),
            })}
            sticker={() => (card.type === "photo" && canCutOutPhoto(viewer, card) ? { kind: "photo", title: "Sticker from this photo", src, source: { kind: "card", id: card.id } } : null)}
          />
        </div>
      )}
      <figcaption className={cn("px-1 pt-3 font-hand", shareable && "min-h-12 pr-12")}>
        {note && (
          <p className="m-0 line-clamp-3 text-title leading-[1.25]" lang={text && text !== note ? displayLang : card.lang}>
            {text ?? note}
            {signed && by ? <span className="text-[#4a413a]">{` — ${by}`}</span> : null}
          </p>
        )}
        {(when || where) && (
          <p className={cn("m-0 text-headline leading-snug text-[#4a413a]", note && "mt-1")}>
            {[when, where].filter(Boolean).join(" · ")}
          </p>
        )}
      </figcaption>
    </figure>
  );
}
