import { describe, expect, it } from "vitest";
import type { Chapter } from "@/app/api/book/chapters";
import { bookDocument, chapterLink } from "@/lib/book-print";
import type { Card } from "@/lib/schemas";

const ch = (id: string, at: string, over: Partial<Card> = {}, title = "One thing you miss"): Chapter => ({
  id: `t-${id}`,
  title,
  source: "today",
  at,
  year: new Date(at).getUTCFullYear(),
  card: { id, familyId: "f", type: "audio", caption: "", summary: "", lang: "en", takenAt: at, ritualSlug: null, source: "today", mediaRef: null, peaks: [], palette: [], transcript: "", transcriptLang: "en", segments: [], authorId: "m", coverRef: null, addressedTo: null, place: "", note: "", ...over } as Card,
});

describe("the printable book", () => {
  const chapters = [ch("c3", "2026-03-02T10:00:00.000Z", { transcript: "Third." }), ch("c1", "2025-12-30T10:00:00.000Z", { transcript: "First.\n\n  Still   first." }), ch("c2", "2026-01-05T10:00:00.000Z", { caption: "Only a caption" })];
  const doc = bookDocument({ name: "Maa", portrait: "/demo/maa.webp", chapters, origin: "https://nearer.example/" });

  it("reads forward in time, numbered from 1", () => {
    expect(doc.pages.map((p) => [p.n, p.cardId])).toEqual([[1, "c1"], [2, "c2"], [3, "c3"]]);
  });
  it("puts the person's name on the cover with their portrait and the span of years", () => {
    expect(doc).toMatchObject({ title: "The book of Maa", name: "Maa", portrait: "/demo/maa.webp", subtitle: "3 chapters · 2025 to 2026" });
  });
  it("gives each chapter its date, question, own words and a QR link to the voice in the app", () => {
    expect(doc.pages[0]).toMatchObject({ date: "December 30, 2025", title: "One thing you miss", words: "First.\nStill first.", qrUrl: "https://nearer.example/home?card=c1" });
    expect(doc.pages[1].words).toBe("Only a caption");
    expect(chapterLink("https://x.test", "a b")).toBe("https://x.test/home?card=a%20b");
  });
  it("keeps a chapter with no transcript (the QR carries the voice) and never repeats a card", () => {
    const d = bookDocument({ name: "Maa", portrait: null, origin: "https://x.test", chapters: [ch("v", "2026-01-01T00:00:00.000Z"), ch("v", "2026-01-02T00:00:00.000Z")] });
    expect(d.pages).toHaveLength(1);
    expect(d.pages[0].words).toBe("");
    expect(d.subtitle).toBe("1 chapter · 2026");
  });
  it("an empty book is a cover with no span", () => {
    expect(bookDocument({ name: "Maa", portrait: null, origin: "https://x.test", chapters: [] })).toMatchObject({ pages: [], subtitle: "" });
  });
});
