"use client";

import { useEffect } from "react";

// Tell the Nearer team when the app breaks on someone's phone, without anything personal:
// the page path, the message, the top of the stack, the build. The server cleans it again.
// A handful per page load, the same error once, and never anything the person typed.

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
const MAX_PER_LOAD = 5;
const sent = new Set<string>();

/** Send one report (best effort, never throws, never blocks anything). */
export function reportError(error: unknown, extra: { route?: string } = {}): void {
  try {
    if (typeof window === "undefined" || sent.size >= MAX_PER_LOAD) return;
    const e = error as { message?: unknown; stack?: unknown } | string | null | undefined;
    const message = typeof e === "string" ? e : typeof e?.message === "string" ? e.message : String(e ?? "");
    const stack = typeof e === "object" && e && typeof e.stack === "string" ? e.stack : "";
    const key = message.slice(0, 80);
    if (!message || sent.has(key)) return;
    sent.add(key);
    const body = JSON.stringify({ route: extra.route ?? window.location.pathname, message: message.slice(0, 300), stack: stack.split("\n").slice(0, 5).join("\n").slice(0, 900), build: BUILD });
    void fetch("/api/beacon", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
  } catch {
    /* reporting must never be the thing that breaks */
  }
}

/** Mounted once in the shell: unhandled errors and rejected promises. */
export function ErrorBeacon() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => reportError(ev.error ?? ev.message);
    const onRejection = (ev: PromiseRejectionEvent) => reportError(ev.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
