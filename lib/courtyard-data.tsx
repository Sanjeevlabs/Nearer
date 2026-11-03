"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { fetchFirst } from "./early";
import { fetchGet } from "./retry";

// The courtyard reads a dozen small payloads on first paint. Inside
// <CourtyardProvider> they arrive in one GET /api/courtyard instead, and
// useJson (lib/use-json.ts) reads its slice from here. Outside the courtyard,
// or for a slice the endpoint left out, useJson fetches the route itself.

/** Route URL → key in the /api/courtyard payload. */
const SLICES: Record<string, string> = {
  "/api/sides": "sides",
  "/api/safety": "safety",
  "/api/gather/events": "events",
  "/api/today": "today",
  "/api/suggestions?status=pending": "suggestions",
  "/api/letters": "letters",
  "/api/presence": "presence",
  "/api/together": "together",
  "/api/sit": "sit",
  "/api/gifts": "gifts",
  "/api/keeper": "keeper",
  "/api/care": "care",
  "/api/stories": "stories",
  "/api/festival-week": "festivalWeek",
  "/api/habits": "habits",
  "/api/kid-ask": "kidAsk",
  "/api/bedtime": "bedtime",
};

export interface CourtyardValue {
  /** null until the first answer; "failed" when /api/courtyard itself failed. */
  status: "loading" | "ok" | "failed";
  data: Record<string, unknown>;
  reload: () => Promise<void>;
}

const Ctx = createContext<CourtyardValue | null>(null);

// One first load per person/family, shared: the provider remounts when the family changes (a side
// switch), and that remount must not ask again for what the switch already asked for.
let gen = 0;
let first: { gen: number; at: number; p: Promise<Record<string, unknown>> } | null = null;
const SHARE_MS = 3000;

function firstLoad(): Promise<Record<string, unknown>> {
  if (first && first.gen === gen && Date.now() - first.at < SHARE_MS) return first.p;
  const p = fetchFirst("/api/courtyard").then(async (res) => {
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as Record<string, unknown>;
  });
  p.catch(() => undefined);
  first = { gen, at: Date.now(), p };
  return p;
}

async function refresh(): Promise<Record<string, unknown>> {
  const res = await fetchGet("/api/courtyard");
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as Record<string, unknown>;
}

if (typeof window !== "undefined")
  window.addEventListener("aangan:auth", () => {
    gen++;
    first = null;
  });

/** What useJson should do for `url`: read the shared payload, or fetch alone. */
export function useCourtyardSlice(url: string | null): { shared: boolean; data: unknown; failed: boolean; reload: () => Promise<void> } | null {
  const ctx = useContext(Ctx);
  if (!ctx || !url) return null;
  const key = SLICES[url];
  if (!key) return null;
  if (ctx.status === "failed" || (ctx.status === "ok" && !(key in ctx.data))) return null;
  return { shared: true, data: ctx.status === "ok" ? ctx.data[key] : null, failed: false, reload: ctx.reload };
}

export function CourtyardProvider({ children, every = 60_000 }: { children: React.ReactNode; every?: number }) {
  const [state, setState] = useState<{ status: CourtyardValue["status"]; data: Record<string, unknown> }>({ status: "loading", data: {} });
  const live = useRef(true);
  const load = useCallback(async (quiet: boolean) => {
    const asked = gen;
    try {
      // The first load may already be on its way (the page's inline script, or the switch that remounted this).
      const data = quiet ? await refresh() : await firstLoad();
      // An answer for the last person or family is dropped.
      if (live.current && asked === gen) setState({ status: "ok", data });
    } catch {
      // A failed quiet refresh keeps what's shown; a failed first load hands every hook back its own fetch.
      if (live.current && !quiet && asked === gen) setState((s) => (s.status === "ok" ? s : { status: "failed", data: {} }));
    }
  }, []);
  useEffect(() => {
    live.current = true;
    void load(false);
    const tick = () => {
      if (!document.hidden) void load(true);
    };
    const timer = setInterval(tick, every);
    document.addEventListener("visibilitychange", tick);
    // A write elsewhere (lib/use-json.ts invalidateJson) refreshes every slice; a new person or family starts empty.
    const changed = () => void load(true);
    const reset = () => {
      setState({ status: "loading", data: {} });
      void load(false);
    };
    window.addEventListener("aangan:changed", changed);
    window.addEventListener("aangan:auth", reset);
    return () => {
      live.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("aangan:changed", changed);
      window.removeEventListener("aangan:auth", reset);
    };
  }, [load, every]);
  const reload = useCallback(() => load(true), [load]);
  const value = useMemo<CourtyardValue>(() => ({ status: state.status, data: state.data, reload }), [state, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The shared courtyard state, or null outside <CourtyardProvider>. */
export function useCourtyard(): CourtyardValue | null {
  return useContext(Ctx);
}

/** Start the courtyard's first load now (the door is swinging open); the provider that mounts after it shares it. */
export function prefetchCourtyard(): void {
  void firstLoad().catch(() => undefined);
}
