// The Book, on paper. Pure: turns a person's chapters into the pages of a
// small printed book (A5): a cover, then one chapter per page, oldest first,
// each with the date, the question, their words and a QR that opens the voice.
// The print page (app/book/print) lays this out; "Save as PDF" is the browser's.
import type { Chapter } from "@/app/api/book/chapters";

export interface BookPage {
  /** Chapter number in the printed order, from 1. */
  n: number;
  cardId: string;
  /** "October 20, 2026" */
  date: string;
  iso: string;
  title: string;
  /** What they said, as written down. "" when the voice was never transcribed. */
  words: string;
  lang: string;
  /** Opens this voice in the app. */
  qrUrl: string;
}

export interface BookDocument {
  /** "The book of Maa" */
  title: string;
  name: string;
  portrait: string | null;
  /** "12 chapters · 2025 to 2026" */
  subtitle: string;
  pages: BookPage[];
}

const MAX_WORDS_CHARS = 2400;

function dateLine(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

const tidy = (s: string) => s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

/** Where a chapter's QR points: the voice inside the app. */
export function chapterLink(origin: string, cardId: string): string {
  return `${origin.replace(/\/$/, "")}/home?card=${encodeURIComponent(cardId)}`;
}

/**
 * The printable book. Chapters are re-ordered oldest first (a book reads forward
 * in time) and numbered, whatever order they arrive in; a card appears once.
 */
export function bookDocument({ name, portrait, chapters, origin }: { name: string; portrait: string | null; chapters: Chapter[]; origin: string }): BookDocument {
  const seen = new Set<string>();
  const ordered = [...chapters].sort((a, b) => a.at.localeCompare(b.at)).filter((c) => (seen.has(c.card.id) ? false : (seen.add(c.card.id), true)));
  const pages: BookPage[] = ordered.map((c, i) => ({
    n: i + 1,
    cardId: c.card.id,
    date: dateLine(c.at),
    iso: c.at,
    title: c.title,
    words: tidy(c.card.transcript || c.card.caption || "").slice(0, MAX_WORDS_CHARS),
    lang: c.card.transcript ? c.card.transcriptLang : c.card.lang,
    qrUrl: chapterLink(origin, c.card.id),
  }));
  const years = ordered.map((c) => c.year);
  const first = Math.min(...years);
  const last = Math.max(...years);
  const count = `${pages.length} chapter${pages.length === 1 ? "" : "s"}`;
  return {
    title: `The book of ${name}`,
    name,
    portrait,
    subtitle: pages.length === 0 ? "" : first === last ? `${count} · ${first}` : `${count} · ${first} to ${last}`,
    pages,
  };
}
