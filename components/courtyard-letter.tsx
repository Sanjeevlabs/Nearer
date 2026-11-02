"use client";

import { useState } from "react";
import type { Suggestion } from "@/lib/schemas";
import { isGrownUp } from "@/lib/permissions";
import { relativeDay } from "@/lib/people";
import { useJson } from "@/lib/use-json";
import { Icon } from "./ui/kit";
import { useViewer } from "./viewer";

// "A letter from the courtyard": the week's letter waits here for a grown-up
// to send it; once sent, everyone can read it. Nothing happens until approval.
type Written = { id: string; title?: string; body?: string; lang?: string; deliverAt: string };
type Draft = { title?: string; body?: string; lang?: string; action?: string };

const WEEK = 7 * 86_400_000;

/** The first two lines of the letter, past the greeting. */
function peek(body: string): string {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 2 && /,$|:$/.test(lines[0]) && lines[0].length < 24) lines.shift();
  return lines.slice(0, 2).join("\n");
}

const Label = () => (
  <p className="m-0 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-[0.1em] text-ink-soft">
    <Icon name="sparkle" size={14} /> From the courtyard
  </p>
);

export function CourtyardLetter() {
  const { viewer } = useViewer();
  const pending = useJson<{ suggestions: Suggestion[] }>("/api/suggestions?status=pending");
  const sent = useJson<{ written?: Written[] }>("/api/letters");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const draft = (pending.data?.suggestions ?? []).find((s) => (s.payload as Draft).action === "weekly_letter");
  const grownUp = isGrownUp(viewer) && viewer.role !== "child";
  const letter = (sent.data?.written ?? []).find((l) => Date.now() - Date.parse(l.deliverAt) < WEEK);

  const decide = async (approve: boolean) => {
    if (!draft) return;
    setBusy(true);
    try {
      await fetch(`/api/suggestions/${draft.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: approve ? "approve" : "reject" }) });
      await Promise.all([pending.reload(), sent.reload()]);
    } finally {
      setBusy(false);
    }
  };

  if (draft && grownUp) {
    const p = draft.payload as Draft;
    return (
      <section data-ui="courtyard-letter" aria-label="A letter from the courtyard" className="mt-5 rounded-[26px] bg-surface p-4">
        <Label />
        <p className="voice m-0 mt-2 text-title leading-snug text-ink">{p.title ?? "A letter from the courtyard"}</p>
        <p className="m-0 mt-1.5 line-clamp-2 whitespace-pre-line text-callout leading-snug text-ink-soft">{peek(p.body ?? "")}</p>
        <p className="m-0 mt-3 text-body font-semibold text-ink">{draft.goal}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void decide(true)} className="press h-11 rounded-full bg-accent px-5 text-callout font-semibold text-accent-ink disabled:opacity-40">
            Do it
          </button>
          <button type="button" disabled={busy} onClick={() => void decide(false)} className="press h-11 rounded-full px-4 text-callout font-semibold text-ink-soft disabled:opacity-40">
            Not now
          </button>
        </div>
      </section>
    );
  }

  if (!letter?.body) return null;
  return (
    <section data-ui="courtyard-letter" aria-label="A letter from the courtyard" className="mt-5 rounded-[26px] bg-surface p-4">
      <Label />
      <p className="voice m-0 mt-2 text-title leading-snug text-ink">{letter.title ?? "A letter from the courtyard"}</p>
      <p className={`m-0 mt-1.5 whitespace-pre-line text-callout leading-snug text-ink-soft ${open ? "" : "line-clamp-2"}`}>{open ? letter.body : peek(letter.body)}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-caption text-ink-soft">{relativeDay(letter.deliverAt)}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="press h-11 rounded-full px-4 text-callout font-semibold text-ink">
          {open ? "Close" : "Read"}
        </button>
      </div>
    </section>
  );
}
