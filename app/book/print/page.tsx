"use client";

import { LoadFailed } from "@/components/load-failed";
import Link from "next/link";
import QRCode from "qrcode";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Chapter } from "@/app/api/book/chapters";
import { Icon, Photo } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { bookDocument } from "@/lib/book-print";
import { callName, memberPhoto } from "@/lib/people";
import { useJson } from "@/lib/use-json";

// The Book, printable: A5 pages (a cover, then a chapter per page with a QR to
// hear it). "Save as PDF" is the browser's print dialog, so it works anywhere,
// offline-safe and with no PDF library. The pages are paper in dark mode too.

const CSS = `
.book-sheet { background:#fffdf8; color:#1c1b1a; }
.book-sheet .qr svg { width:100%; height:100%; display:block; }
@media print {
  @page { size: A5; margin: 0; }
  html, body { background:#fff !important; }
  body * { visibility:hidden !important; }
  .book-root, .book-root * { visibility:visible !important; }
  .book-root { position:absolute; left:0; top:0; width:148mm; padding:0 !important; margin:0 !important; }
  .book-tools { display:none !important; }
  .book-sheet { width:148mm; min-height:210mm; margin:0 !important; border-radius:0 !important; box-shadow:none !important; padding:16mm 15mm !important; break-after:page; box-sizing:border-box; }
  .book-sheet:last-child { break-after:auto; }
  .book-cover { height:210mm; }
  .book-words { font-size:12pt !important; line-height:1.55 !important; }
}
`;

function BookPrint() {
  const params = useSearchParams();
  const { members, ready, viewer } = useViewer();
  const elders = members.filter((m) => m.role === "elder");
  const memberId = params.get("member") ?? (elders.find((m) => m.id === viewer.id) ?? elders[0])?.id ?? "";
  const person = members.find((m) => m.id === memberId);
  const { data, failed, reload } = useJson<{ chapters: Chapter[] }>(ready && memberId ? `/api/book?member=${encodeURIComponent(memberId)}` : null);
  const [origin, setOrigin] = useState("");
  const [qrs, setQrs] = useState<Record<string, string>>({});

  useEffect(() => setOrigin(window.location.origin), []);
  const doc = useMemo(
    () => (data && origin ? bookDocument({ name: callName(person), portrait: memberPhoto(person), chapters: data.chapters, origin }) : null),
    [data, origin, person],
  );
  useEffect(() => {
    if (!doc) return;
    let live = true;
    void Promise.all(doc.pages.map(async (p) => [p.cardId, await QRCode.toString(p.qrUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1c1b1a", light: "#fffdf8" } })] as const)).then((all) => {
      if (live) setQrs(Object.fromEntries(all));
    });
    return () => {
      live = false;
    };
  }, [doc]);

  if (ready && !person) return <p className="m-0 py-8 text-center text-body text-ink-soft">This person isn&rsquo;t in your family yet.</p>;

  return (
    <div className="book-root">
      <style>{CSS}</style>
      <div className="book-tools mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/book?member=${encodeURIComponent(memberId)}`} className="press flex h-11 items-center gap-1 rounded-full bg-surface px-4 text-callout font-medium text-ink no-underline">
          <Icon name="back" size={16} />
          The Book
        </Link>
        <span className="flex-1" />
        <button type="button" disabled={!doc || doc.pages.length === 0} onClick={() => window.print()} className="press flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-callout font-semibold text-white disabled:opacity-40">
          <Icon name="download" size={16} />
          Save as PDF
        </button>
      </div>
      <p className="book-tools m-0 mb-4 text-footnote text-ink-soft">Choose &ldquo;Save as PDF&rdquo; in the print window. Pages are A5; each QR opens that chapter&rsquo;s voice.</p>

      {failed && !data ? (
        <div className="book-tools">
          <LoadFailed what="The book" ui="book-print-retry" onRetry={() => void reload()} />
        </div>
      ) : !doc ? (
        <div className="book-tools skeleton h-[420px] rounded-[20px]" aria-busy="true" aria-label="Loading" />
      ) : (
        <div className="space-y-4">
          <section aria-label="Cover" className="book-sheet book-cover relative mx-auto flex w-full max-w-[148mm] flex-col items-center justify-between overflow-hidden rounded-[10px] px-6 py-10 text-center" style={{ boxShadow: "0 12px 32px rgba(0,0,0,.25)", aspectRatio: "148 / 210" }}>
            <p className="m-0 text-caption uppercase tracking-[0.3em]" style={{ color: "#6b6258" }}>In their own voice</p>
            <div className="flex flex-col items-center">
              {doc.portrait && (
                <span className="relative mb-6 block h-40 w-40 overflow-hidden rounded-full">
                  <Photo src={doc.portrait} alt="" sizes="320px" priority position="center 28%" />
                </span>
              )}
              <h1 className="voice m-0 break-words text-display leading-[1.05]">{doc.title}</h1>
              {doc.subtitle && <p className="m-0 mt-3 text-footnote" style={{ color: "#6b6258" }}>{doc.subtitle}</p>}
            </div>
            <p className="m-0 text-caption" style={{ color: "#6b6258" }}>Kept with Nearer</p>
          </section>

          {doc.pages.length === 0 && <p className="book-tools m-0 py-6 text-center text-body text-ink-soft">No chapters yet. Every answer to the daily question becomes a page.</p>}

          {doc.pages.map((p) => (
            <article key={p.cardId} className="book-sheet mx-auto flex w-full max-w-[148mm] flex-col rounded-[10px] px-6 py-8" style={{ boxShadow: "0 12px 32px rgba(0,0,0,.25)", minHeight: "min(70vh, 210mm)" }}>
              <p className="m-0 text-caption uppercase tracking-[0.2em]" style={{ color: "#6b6258" }}>
                Chapter {p.n} · {p.date}
              </p>
              <h2 className="m-0 mt-2 break-words text-title font-semibold leading-snug">{p.title}</h2>
              {p.words ? (
                <p lang={p.lang} className="book-words voice m-0 mt-4 whitespace-pre-line break-words text-headline leading-[1.55]">
                  {p.words}
                </p>
              ) : (
                <p className="book-words m-0 mt-4 text-body" style={{ color: "#6b6258" }}>
                  This one was spoken, not written. Scan to hear it.
                </p>
              )}
              <div className="mt-auto flex items-end gap-3 pt-6">
                <span className="qr block h-[22mm] w-[22mm] shrink-0" aria-label="QR code that opens this voice in the app" role="img" dangerouslySetInnerHTML={{ __html: qrs[p.cardId] ?? "" }} />
                <p className="m-0 text-caption" style={{ color: "#6b6258" }}>
                  Scan to hear {doc.name}&rsquo;s voice
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BookPrintPage() {
  return (
    <Suspense fallback={<div className="skeleton mt-16 h-[300px] rounded-[28px]" aria-busy="true" />}>
      <BookPrint />
    </Suspense>
  );
}
