"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AUTH_INTENT_KEY, browserAuth } from "@/lib/supabase-browser";
import { resetFamilyCards } from "@/lib/use-family";

// Back from Google or a magic link: turn the Supabase sign-in into Nearer's
// own session (POST /api/auth/verify with the token), with what you were
// doing before you left (sign in, start a family, join one).
interface Saved {
  mode: "signin" | "create" | "join";
  intent: unknown;
  tz?: string;
  birthday?: string;
  city?: string;
}

function readIntent(): Saved | null {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(AUTH_INTENT_KEY);
      if (raw) return JSON.parse(raw) as Saved;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function clearIntent() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      store.removeItem(AUTH_INTENT_KEY);
    } catch {
      /* ignore */
    }
  }
}

export default function AuthCallback() {
  const [state, setState] = useState<"working" | "no-family" | "failed">("working");
  useEffect(() => {
    void (async () => {
      const sb = browserAuth();
      if (!sb) return setState("failed");
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const { data, error } = code ? await sb.auth.exchangeCodeForSession(code) : await sb.auth.getSession();
      const token = data.session?.access_token;
      if (error || !token) return setState("failed");
      const saved = readIntent() ?? { mode: "signin" as const, intent: { type: "signin" } };
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken: token, intent: saved.intent, tz: saved.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone, birthday: saved.birthday, city: saved.city }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string; welcome?: string };
      void sb.auth.signOut({ scope: "local" });
      if (!res.ok) return setState(out.error === "no-family" ? "no-family" : "failed");
      clearIntent();
      try {
        if (out.welcome) sessionStorage.setItem("aangan:welcome", out.welcome);
        sessionStorage.removeItem("aangan:entered");
      } catch {
        /* private mode */
      }
      resetFamilyCards();
      window.dispatchEvent(new Event("aangan:auth"));
      window.location.replace(saved.mode === "create" ? "/create?resume=other-side" : "/");
    })();
  }, []);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
      {state === "working" && <p className="m-0 text-body text-ink-soft">Opening your window…</p>}
      {state === "no-family" && (
        <>
          <p className="m-0 text-headline">You&rsquo;re signed in, but not in a family yet.</p>
          <div className="flex gap-3">
            <Link href="/create" className="press rounded-full bg-accent px-5 py-3 text-body font-semibold text-accent-ink no-underline">
              Start a family
            </Link>
            <Link href="/join" className="press rounded-full bg-tint px-5 py-3 text-body font-semibold text-ink no-underline">
              Join with a code
            </Link>
          </div>
        </>
      )}
      {state === "failed" && (
        <>
          <p className="m-0 text-headline">That sign-in link didn&rsquo;t work.</p>
          <Link href="/signin" className="press rounded-full bg-accent px-5 py-3 text-body font-semibold text-accent-ink no-underline">
            Try again
          </Link>
        </>
      )}
    </div>
  );
}
