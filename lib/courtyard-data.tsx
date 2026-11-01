"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

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
    try {
      const res = await fetch("/api/courtyard", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Record<string, unknown>;
      if (live.current) setState({ status: "ok", data });
    } catch {
      // A failed quiet refresh keeps what's shown; a failed first load hands every hook back its own fetch.
      if (live.current && !quiet) setState((s) => (s.status === "ok" ? s : { status: "failed", data: {} }));
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
