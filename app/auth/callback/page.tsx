"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AUTH_INTENT_KEY, browserAuth } from "@/lib/supabase-browser";
import { PKCE_VERIFIER_KEY, afterSignin, callbackFailure, verifyAccessToken } from "@/lib/auth-session";
import { resetFamilyCards } from "@/lib/use-family";
import { useT } from "@/lib/use-t";

// Back from Google or a magic link: a family you have opens; a family link you were joining goes on
// to its page; no family yet goes to the one setup screen. The Supabase session is kept for those two,
// so Google isn't asked twice.
interface Saved {
  joinCode?: string;
  /** Older saved intents (before one door): next=join with its code. */
  next?: string;
  nextCode?: string;
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
  const [state, setState] = useState<"working" | "failed" | "other-device">("working");
  const t = useT();
  useEffect(() => {
    void (async () => {
      const sb = browserAuth();
      if (!sb) return setState("failed");
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      let hasVerifier = true;
      try {
        hasVerifier = Boolean(localStorage.getItem(PKCE_VERIFIER_KEY));
      } catch {
        /* storage blocked: let the exchange say */
      }
      // A link opened where it wasn't asked for has no verifier: say so instead of a bare failure.
      if (code && !hasVerifier) return setState(callbackFailure({ hasCode: true, hasVerifier: false }));
      const { data, error } = code ? await sb.auth.exchangeCodeForSession(code) : await sb.auth.getSession();
      const token = data.session?.access_token;
      if (error || !token) return setState(callbackFailure({ hasCode: Boolean(code), hasVerifier, errorMessage: error?.message }));
      const saved = readIntent() ?? {};
      clearIntent();
      const joinCode = saved.joinCode ?? (saved.next === "join" ? saved.nextCode : undefined);
      // Joining by link: its page carries on with this session (open it, "join this one too?", or pick your name).
      if (joinCode) return window.location.replace(`/join/${encodeURIComponent(joinCode)}`);
      const out = await verifyAccessToken(sb, { accessToken: token, intent: { type: "signin" }, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }, (e) => e === "no-family");
      const after = afterSignin(out);
      // No family yet: the setup screen (the Supabase session is kept).
      if (after.kind === "setup") return window.location.replace("/signin");
      if (after.kind === "failed" || !out.ok) return setState("failed");
      try {
        if (out.welcome) sessionStorage.setItem("aangan:welcome", out.welcome);
        sessionStorage.setItem("aangan:entered", "1"); // just signed in: straight into the app, never the home page
      } catch {
        /* private mode */
      }
      resetFamilyCards();
      window.dispatchEvent(new Event("aangan:auth"));
      window.location.replace("/");
    })();
  }, []);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
      {state === "working" && <p className="m-0 text-body text-ink-soft">{t("callback.working")}</p>}
      {(state === "failed" || state === "other-device") && (
        <>
          <p className="m-0 text-headline">{state === "other-device" ? t("callback.otherDevice") : t("callback.failed")}</p>
          <Link href="/signin" className="press rounded-full bg-accent px-5 py-3 text-body font-semibold text-accent-ink no-underline">
            {t("callback.tryAgain")}
          </Link>
        </>
      )}
    </div>
  );
}
