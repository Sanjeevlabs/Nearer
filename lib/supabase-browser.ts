"use client";
// Supabase Auth in the browser, only for signing in (Google, a magic link, a
// phone code). Nearer's own signed session cookie is minted by
// /api/auth/verify from the Supabase token; Supabase's session is then dropped.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function browserAuth(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Mock mode and local runs without Supabase use the 6-digit code path (000000).
  client = url && key && process.env.NEXT_PUBLIC_MOCK !== "true" ? createClient(url, key, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: false, storageKey: "aangan-auth" } }) : null;
  return client;
}

/** Which ways in are switched on. Google needs the provider enabled in Supabase; phone needs an SMS provider there. */
export function signInOptions(): { google: boolean; phone: boolean; live: boolean } {
  const live = Boolean(browserAuth());
  return { live, google: live && process.env.NEXT_PUBLIC_AUTH_GOOGLE !== "false", phone: live && process.env.NEXT_PUBLIC_AUTH_PHONE === "true" };
}

export const AUTH_INTENT_KEY = "aangan:auth-intent";

export function callbackUrl(): string {
  return `${window.location.origin}/auth/callback`;
}
