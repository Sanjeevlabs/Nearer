"use client";

import { useEffect, useState } from "react";
import { needsDisplayText } from "./voice";

// Translated view of a stored original string in the viewer's display_lang.
// Returns the original immediately when no translation is needed; otherwise
// returns null while the cached per-card+lang translation loads, so the UI
// shows a skeleton and never flashes untranslated Hindi.
// One cache for the tab: the same words in the same language are asked for once,
// however many places show them (a prompt list re-mounts often).
const done = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function fetchTranslation(original: string, displayLang: string): Promise<string> {
  const key = `${displayLang}::${original}`;
  const hit = done.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const p = fetch("/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: original, targetLang: displayLang }),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { translation?: { text?: string } } | null) => {
      const next = data?.translation?.text;
      // Only a real answer is kept; a refused or failed call may be asked again later.
      if (next) done.set(key, next);
      return next ?? original;
    })
    .catch(() => original)
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

export function useDisplayText(
  original: string,
  sourceLang: string | null | undefined,
  displayLang: string,
): { text: string | null; translated: boolean } {
  const [translated, setTranslated] = useState<string | null>(null);

  const need = needsDisplayText(original, sourceLang, displayLang);

  useEffect(() => {
    if (!need) {
      setTranslated(null);
      return;
    }
    const hit = done.get(`${displayLang}::${original}`);
    if (hit !== undefined) {
      setTranslated(hit);
      return;
    }
    let live = true;
    setTranslated(null);
    void fetchTranslation(original, displayLang).then((next) => {
      if (live) setTranslated(next);
    });
    return () => {
      live = false;
    };
  }, [original, sourceLang, displayLang, need]);

  if (!need) return { text: original, translated: false };
  if (translated === null) return { text: null, translated: true };
  return { text: translated, translated: true };
}
