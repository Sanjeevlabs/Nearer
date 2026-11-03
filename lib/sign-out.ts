"use client";
// The real sign-out: lib/auth-session.ts runs the steps in order; these are the browser's.
import { signOutEverywhere, type SignOutSteps } from "./auth-session";
import { clearSwCachesQuietly } from "./sw-clear";
import { dropEarly } from "./early";
import { closeFetchGate } from "./net-gate";
import { AUTH_INTENT_KEY, browserAuth } from "./supabase-browser";
import { clearJsonCache } from "./use-json";
import { resetFamilyCards } from "./use-family";
import { forgetPushDevice } from "./web-push";

const steps: SignOutSteps = {
  stopPollers: closeFetchGate,
  forgetPush: forgetPushDevice,
  deleteSession: async () => {
    await fetch("/api/session", { method: "DELETE" });
  },
  supabaseSignOut: async () => {
    await browserAuth()?.auth.signOut({ scope: "local" });
  },
  clearStorage: () => {
    for (const store of [sessionStorage, localStorage]) {
      try {
        store.removeItem(AUTH_INTENT_KEY);
        for (const k of Object.keys(store)) if (k.startsWith("aangan-auth")) store.removeItem(k);
      } catch {
        /* private mode */
      }
    }
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  },
  clearCaches: () => {
    resetFamilyCards();
    dropEarly();
    clearJsonCache();
  },
  clearServiceWorker: () => clearSwCachesQuietly(),
  goTo: (path) => window.location.replace(path),
};

/** Sign out of Nearer and Supabase, forget everything cached, and reload at `to`. */
export function signOutNow(to = "/"): Promise<void> {
  return signOutEverywhere(steps, to);
}
