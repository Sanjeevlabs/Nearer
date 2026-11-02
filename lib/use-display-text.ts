"use client";

import { useEffect, useState } from "react";
import { needsDisplayText } from "./voice";

// Translated view of a stored original string in the viewer's display_lang.
// Returns the original immediately when no translation is needed; otherwise
// returns null while the cached per-card+lang translation loads, so the UI
// shows a skeleton and never flashes untranslated Hindi.
// One cache for the tab (kept in sessionStorage across page loads): the same
// words in the same language are asked for once, however many places show
// them. Words asked for in the same moment go in one request.
const STORE_KEY = "aangan:tx";
const done = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let loaded = false;

function loadStore(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) done.set(k, v);
  } catch {
    /* private mode or no storage: memory only */
  }
}

function saveStore(): void {
  try {
    // The newest 300 are plenty for a session.
    sessionStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries([...done].slice(-300))));
  } catch {
    /* full or blocked: memory only */
  }
}

function cached(original: string, displayLang: string): string | undefined {
  loadStore();
  return done.get(`${displayLang}::${original}`);
}

let queue: { text: string; lang: string; resolve: (t: string) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  timer = null;
  const batch = queue;
  queue = [];
  const byLang = new Map<string, typeof batch>();
  for (const q of batch) byLang.set(q.lang, [...(byLang.get(q.lang) ?? []), q]);
  for (const [lang, items] of byLang) {
    for (let i = 0; i < items.length; i += 40) {
      const part = items.slice(i, i + 40);
      let out: (string | undefined)[] = [];
      try {
        const res = await fetch("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texts: part.map((p) => p.text), targetLang: lang }) });
        const data = res.ok ? ((await res.json()) as { translations?: { text?: string }[] }) : null;
        out = data?.translations?.map((t) => t.text) ?? [];
      } catch {
        out = [];
      }
      part.forEach((p, k) => {
        const next = out[k];
        // Only a real answer is kept; a refused or failed call may be asked again later.
        if (next) done.set(`${lang}::${p.text}`, next);
        p.resolve(next ?? p.text);
      });
      if (out.length) saveStore();
    }
  }
}

function fetchTranslation(original: string, displayLang: string): Promise<string> {
  const key = `${displayLang}::${original}`;
  const hit = cached(original, displayLang);
  if (hit !== undefined) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const p = new Promise<string>((resolve) => {
    queue.push({ text: original, lang: displayLang, resolve });
    if (!timer) timer = setTimeout(() => void flush(), 30);
  }).finally(() => pending.delete(key));
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
    const hit = cached(original, displayLang);
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
