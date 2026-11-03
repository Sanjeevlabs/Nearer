"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AUTH_INTENT_KEY, browserAuth } from "@/lib/supabase-browser";
import { PKCE_VERIFIER_KEY, afterAuth, afterSignin, callbackFailure, verifyAccessToken } from "@/lib/auth-session";
import { resetFamilyCards } from "@/lib/use-family";
import { useT } from "@/lib/use-t";

// Back from Google or a magic link: turn the Supabase sign-in into Nearer's
// own session (POST /api/auth/verify with the token), with what you were
// doing before you left (sign in, start a family, join one).
interface Saved {
  mode: "signin" | "create" | "join";
  /** Came from /signin?next=create|join: keep the session and go on to that form. */
  next?: "create" | "join";
  nextCode?: string;
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
  const [state, setState] = useState<"working" | "no-family" | "failed" | "other-device">("working");
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
      const saved = readIntent() ?? { mode: "signin" as const, intent: { type: "signin" } };
      const go = afterAuth({ next: saved.next ?? null, code: saved.nextCode });
      if (!go.verify) {
        clearIntent();
        window.location.replace(go.to);
        return;
      }
      // "No family yet" keeps the Supabase session: /create and /join reuse it, so Google isn't asked twice.
      const out = await verifyAccessToken(sb, { accessToken: token, intent: saved.intent, tz: saved.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone, birthday: saved.birthday, city: saved.city }, (e) => e === "no-family");
      const after = afterSignin(out);
      if (after.kind === "chooser") {
        // Came to start a family and has none: on to the form (the Supabase session is kept).
        if (go.noFamilyTo) {
          clearIntent();
          window.location.replace(go.noFamilyTo);
          return;
        }
        return setState("no-family");
      }
      if (after.kind === "failed" || !out.ok) return setState("failed");
      clearIntent();
      try {
        if (out.welcome) sessionStorage.setItem("aangan:welcome", out.welcome);
        sessionStorage.removeItem("aangan:entered");
      } catch {
        /* private mode */
      }
      resetFamilyCards();
      window.dispatchEvent(new Event("aangan:auth"));
      // Already had a family: the server opened it, so no "other side" step for a family that wasn't made.
      window.location.replace(saved.mode === "create" && !out.existing ? "/create?resume=other-side" : "/");
    })();
  }, []);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
      {state === "working" && <p className="m-0 text-body text-ink-soft">{t("callback.working")}</p>}
      {state === "no-family" && (
        <>
          <p className="m-0 text-headline">{t("callback.noFamily")}</p>
          <div className="flex gap-3">
            <Link href="/create" className="press rounded-full bg-accent px-5 py-3 text-body font-semibold text-accent-ink no-underline">
              {t("auth.startFamily")}
            </Link>
            <Link href="/join" className="press rounded-full bg-tint px-5 py-3 text-body font-semibold text-ink no-underline">
              {t("landing.join")}
            </Link>
          </div>
        </>
      )}
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
