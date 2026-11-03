"use client";

import { Lockup } from "./brand";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { joinLink, whatsappInvite } from "@/lib/invite-link";
import { resetFamilyCards } from "@/lib/use-family";
import { postJson } from "@/lib/use-json";
import { useDocumentLang, useT, type T } from "@/lib/use-t";
import { en, htmlLang, type UiKey } from "@/lib/ui-strings/lazy";
import { cn } from "@/lib/utils";
import { AUTH_INTENT_KEY, browserAuth, signInOptions } from "@/lib/supabase-browser";
import { signOutNow } from "@/lib/sign-out";
import { afterAuth, afterSignin, currentSession, gateDecision, nextHref, parseNext, signinHref, signinShortcut, verifyAccessToken, type Next } from "@/lib/auth-session";
import { authRedirectUrl, isNative, openExternal } from "@/lib/native";
import { useShell } from "./shell";
import { Button, Icon } from "./ui/kit";

type Mode = "create" | "join" | "signin";
type Step = "details" | "email" | "code" | "nofamily" | "other-side" | "invite";

/** Month names in the viewer's language (Intl), never a hard-coded list. */
function monthNames(lang: string): string[] {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat(lang, { month: "short", timeZone: "UTC" });
  } catch {
    fmt = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
  }
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2000, i, 15))));
}

/** Server error code → a translated line (unknown codes read the generic one). */
function errorText(t: T, code: string): string {
  const key = `error.${code}`;
  return key in en ? t(key as UiKey) : t("error.generic");
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="mt-4 block">
      <span className="mb-1.5 block text-footnote font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-footnote text-ink-faint">{hint}</span>}
    </label>
  );
}

const input = "h-12 w-full rounded-full bg-surface px-5 text-body outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-black/15";

interface Peek {
  family: string;
  host: string | null;
  places: { id: string; callName: string }[];
}

export function AuthFlow({ mode }: { mode: Mode }) {
  const router = useRouter();
  const t = useT();
  useDocumentLang();
  const { setChromeHidden } = useShell();
  const [step, setStep] = useState<Step>(mode === "signin" ? "email" : "details");
  const [familyName, setFamilyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [peek, setPeek] = useState<Peek | null>(null);
  const [claim, setClaim] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [callName, setCallName] = useState("");
  const [city, setCity] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [byPhone, setByPhone] = useState(false);
  const [code, setCode] = useState("");
  const ways = signInOptions();
  const [mock, setMock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  // Already proved who they are (Google, then "no family yet"): reuse that instead of asking again.
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  // Live sign-in is the one door: /create and /join wait for a Supabase session (or send you to /signin).
  const live = Boolean(browserAuth());
  const gated = live && mode !== "signin";
  const [ready, setReady] = useState(!gated);
  // /signin?next=create|join: where to go once we know who they are.
  const [target, setTarget] = useState<Next>({ next: null });
  const [alreadyIn, setAlreadyIn] = useState(false);
  const [farNames, setFarNames] = useState<string[]>([]);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setChromeHidden(true);
    return () => setChromeHidden(false);
  }, [setChromeHidden]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("resume") === "other-side") setStep("other-side");
  }, []);
  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (mode === "signin") {
      const wanted = parseNext(window.location.search);
      setTarget(wanted);
      if (q.get("expired")) setError(errorText(t, "session-expired"));
      // Already signed in to Nearer and nothing else to do: no reason to sign in again.
      if (browserAuth() && !wanted.next) {
        void fetch("/api/session", { cache: "no-store" })
          .then(async (res) => (res.ok ? ((await res.json()) as { status?: string }) : null))
          .then((me) => {
            if (signinShortcut({ next: null, sessionOk: Boolean(me), status: me?.status }) === "home") router.replace("/");
          })
          .catch(() => undefined);
      }
      return;
    }
    const sb = browserAuth();
    if (!sb) return;
    const resume = q.get("resume") === "other-side";
    let alive = true;
    void currentSession(sb).then((sess) => {
      if (!alive) return;
      const g = gateDecision({ live: true, hasSession: Boolean(sess), kind: mode, code: q.get("code")?.trim() || undefined, resume });
      if (!g.stay) return router.replace(g.to);
      if (sess) setSignedInAs(sess.email || t("auth.signedInAsYou"));
      setReady(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  // A join link carries the code: /join?code=ABC123.
  useEffect(() => {
    if (mode !== "join") return;
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setInviteCode(c.slice(0, 64));
  }, [mode]);
  // Who sent this code? Offer the place they made for you ("I'm Maa").
  useEffect(() => {
    if (mode !== "join" || inviteCode.trim().length < 6) {
      setPeek(null);
      return;
    }
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/invites/peek?code=${encodeURIComponent(inviteCode.trim())}`, { signal: ctl.signal });
        setPeek(res.ok ? ((await res.json()) as Peek) : null);
      } catch {
        /* typing on */
      }
    }, 350);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [mode, inviteCode]);

  const claimed = peek?.places.find((p) => p.id === claim);
  const months = monthNames(htmlLang(t.lang));
  const title =
    step === "other-side"
      ? t("auth.titleOtherSide")
      : step === "invite"
        ? farNames.length
          ? t("auth.titleInvite", { names: farNames.join(t("auth.namesJoin")) })
          : t("auth.titleInviteThem")
        : step === "email"
          ? mode === "signin"
            ? t("auth.titleSignInUp")
            : t("auth.titleEmail")
          : step === "nofamily"
            ? t("auth.noFamilyTitle")
          : step === "code"
            ? t("auth.titleCheck")
            : mode === "create"
              ? t("auth.titleCreate")
              : peek
                ? peek.host
                  ? t("auth.titleJoinHost", { host: peek.host })
                  : t("auth.titleJoinFamily", { family: peek.family })
                : t("auth.titleJoin");

  const detailsValid = (claimed || firstName.trim()) && (mode === "create" ? familyName.trim() && month && day : inviteCode.trim().length >= 4);

  const phoneE164 = () => `+${phone.replace(/\D/g, "")}`;
  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const sb = browserAuth();
      if (sb) {
        // Live: Supabase sends the code (and, for email, a magic link back to /auth/callback).
        saveIntent();
        const { error: err } = byPhone
          ? await sb.auth.signInWithOtp({ phone: phoneE164() })
          : await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: authRedirectUrl("email"), shouldCreateUser: true } });
        if (err) throw new Error(/rate/i.test(err.message) ? "too-many-attempts" : "code-not-sent");
        setMock(false);
        setStep("code");
        return;
      }
      const res = await fetch("/api/auth/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const data = (await res.json()) as { error?: string; mock?: boolean };
      if (!res.ok) throw new Error(data.error ?? "code-not-sent");
      setMock(Boolean(data.mock));
      setStep("code");
    } catch (e) {
      setError(errorText(t, (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  /** What we're signing in to do, kept across a redirect (Google, a magic link opened on this phone). */
  const intentBody = () => {
    const name = claimed ? claimed.callName : firstName.trim();
    const intent =
      mode === "signin"
        ? { type: "signin" }
        : mode === "create"
          ? { type: "create", familyName: familyName.trim(), firstName: name, callName: callName.trim() || undefined }
          : { type: "join", inviteCode: inviteCode.trim(), firstName: name, callName: claimed ? undefined : callName.trim() || undefined, claimMemberId: claimed?.id };
    return { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, birthday: month && day ? `${month}-${day}` : undefined, city: city.trim() || undefined, intent, mode };
  };
  const saveIntent = () => {
    try {
      const saved = JSON.stringify({ ...intentBody(), ...(target.next ? { next: target.next, nextCode: target.code } : {}) });
      sessionStorage.setItem(AUTH_INTENT_KEY, saved);
      localStorage.setItem(AUTH_INTENT_KEY, saved);
    } catch {
      /* private mode: the callback falls back to sign-in */
    }
  };
  const google = async () => {
    const sb = browserAuth();
    if (!sb) return;
    setBusy(true);
    saveIntent();
    // Google blocks sign-in inside app webviews: in the native app it opens in the system browser
    // and comes back through the site.nearer.app:// deep link.
    const native = isNative();
    const { data, error: err } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: authRedirectUrl("oauth"), skipBrowserRedirect: native, queryParams: { prompt: "select_account" } } });
    if (!err && native && data?.url) await openExternal(data.url);
    if (err) {
      setError(errorText(t, "code-not-sent"));
      setBusy(false);
    }
  };

  const enter = () => {
    resetFamilyCards();
    try {
      sessionStorage.removeItem("aangan:entered");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("aangan:auth"));
    router.replace("/");
  };

  /** Nearer's session is set: remember the welcome, then wait for an admin, open the other side, or go in. */
  const afterVerify = (data: { welcome?: string; status?: string }) => {
    if (data.welcome) {
      try {
        sessionStorage.setItem("aangan:welcome", data.welcome);
      } catch {
        /* private mode */
      }
    }
    // A joiner waiting for an admin: the waiting screen takes over.
    if (data.status === "pending") return enter();
    if (mode === "create") {
      // Signed in: now the other side of the window.
      setBusy(false);
      setStep("other-side");
      return;
    }
    enter();
  };

  /** Details submitted while already signed in: no second sign-in, straight to Nearer's session. */
  const finishWithSession = async () => {
    const sb = browserAuth();
    if (!sb) return setStep("email");
    setBusy(true);
    setAlreadyIn(false);
    setError(null);
    const { mode: _m, ...base } = intentBody();
    void _m;
    const session = await currentSession(sb);
    // Only a rejected token sends them back to sign in; anything else (bad code, name) is fixed on the details step.
    const out = session ? await verifyAccessToken(sb, { accessToken: session.token, ...base }, (e) => e !== "wrong-code") : ({ ok: false, error: "wrong-code" } as const);
    if (out.ok) return afterVerify(out);
    setBusy(false);
    if (out.error === "wrong-code") {
      setSignedInAs(null);
      return router.replace(signinHref(mode === "join" ? "join" : "create", inviteCode.trim() || undefined, true));
    }
    setError(errorText(t, out.error));
    setAlreadyIn(out.error === "already-member");
  };

  const notYou = () => {
    setSignedInAs(null);
    // Everything about the last person goes, then back to the one door.
    void signOutNow(gated ? signinHref(mode === "join" ? "join" : "create", inviteCode.trim() || undefined) : "/");
  };

  const verify = async (value = code) => {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    const { mode: _m, ...base } = intentBody();
    void _m;
    try {
      let identity: Record<string, string> = { email, code: value };
      const sb = browserAuth();
      if (sb && mode === "signin") {
        const out = byPhone ? await sb.auth.verifyOtp({ phone: phoneE164(), token: value, type: "sms" }) : await sb.auth.verifyOtp({ email, token: value, type: "email" });
        const token = out.data.session?.access_token;
        if (out.error || !token) throw new Error("wrong-code");
        // Signing up for a family: the session stays, the family form is next.
        const go = afterAuth(target);
        if (!go.verify) return router.replace(go.to);
        // Otherwise a plain sign-in. No family yet keeps the session for the chooser.
        const res = await verifyAccessToken(sb, { accessToken: token, ...base }, (e) => e === "no-family");
        const after = afterSignin(res);
        if (after.kind === "chooser") {
          setBusy(false);
          setStep("nofamily");
          return;
        }
        if (after.kind === "failed") throw new Error(after.error);
        return afterVerify(res as { welcome?: string; status?: string });
      }
      if (sb) {
        const out = byPhone ? await sb.auth.verifyOtp({ phone: phoneE164(), token: value, type: "sms" }) : await sb.auth.verifyOtp({ email, token: value, type: "email" });
        const token = out.data.session?.access_token;
        if (out.error || !token) throw new Error("wrong-code");
        identity = { accessToken: token };
      }
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...identity, ...base }),
      });
      if (sb) void sb.auth.signOut({ scope: "local" });
      const data = (await res.json()) as { error?: string; welcome?: string; status?: string };
      if (!res.ok) throw new Error(data.error ?? "failed");
      afterVerify(data);
    } catch (e) {
      const key = (e as Error).message;
      setError(errorText(t, key));
      if (key === "wrong-code") setCode("");
      setBusy(false);
    }
  };

  const back = () => {
    setError(null);
    if (step === "other-side" || step === "invite") enter();
    else if (step === "code") setStep("email");
    else if (step === "email" && mode !== "signin") setStep("details");
    else router.push("/");
  };

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-white">
      <div className="mx-auto flex min-h-full max-w-[480px] flex-col px-4" style={{ paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}>
        <div className="flex items-center justify-between">
          <button type="button" onClick={back} aria-label={step === "other-side" || step === "invite" ? t("auth.skip") : t("auth.back")} className="press -ms-2 grid h-11 w-11 place-items-center rounded-full">
            <Icon name={step === "other-side" || step === "invite" ? "close" : "back"} className="rtl:-scale-x-100" />
          </button>
          <Lockup mark={24} word={72} className="text-ink" />
        </div>
        <h1 data-display className="m-0 mt-4 text-display leading-[1.08]">{title}</h1>

        {step === "details" && !ready && <div className="flex-1" aria-busy="true" />}
        {step === "details" && ready && (
          <form
            className="flex flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (!detailsValid) return;
              if (signedInAs) void finishWithSession();
              else setStep("email");
            }}
          >
            <p className="m-0 mt-2 text-body text-ink-soft">{mode === "create" ? t("landing.sub") : t("auth.joinSub")}</p>
            {signedInAs && (
              <p className="m-0 mt-2 text-footnote text-ink-faint">
                {t("auth.signedInAs", { email: signedInAs })} · {" "}
                <button type="button" onClick={notYou} className="press inline p-0 text-footnote font-medium text-ink-soft underline">
                  {t("auth.notYou")}
                </button>
              </p>
            )}
            {mode === "create" ? (
              <Field label={t("auth.familyName")}>
                <input className={input} value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder={t("auth.familyNamePh")} maxLength={40} autoFocus />
              </Field>
            ) : (
              <Field label={t("auth.inviteCode")}>
                <input className={`${input} tnum uppercase tracking-[0.12em]`} value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="ABC123" maxLength={64} autoCapitalize="characters" autoFocus={!inviteCode} />
              </Field>
            )}
            {mode === "join" && peek && peek.places.length > 0 && (
              <div className="mt-4">
                <span className="mb-1.5 block text-footnote font-medium text-ink-soft">{t("auth.whichYou")}</span>
                <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label={t("auth.whichYou")}>
                  {peek.places.map((p) => (
                    <button key={p.id} type="button" role="radio" aria-checked={claim === p.id} onClick={() => setClaim(claim === p.id ? null : p.id)} className={cn("press h-11 shrink-0 rounded-full px-5 text-body font-semibold", claim === p.id ? "bg-accent text-accent-ink" : "bg-surface")}>
                      {t("auth.imName", { name: p.callName })}
                    </button>
                  ))}
                  <button type="button" role="radio" aria-checked={claim === null} onClick={() => setClaim(null)} className={cn("press h-11 shrink-0 rounded-full px-5 text-body font-medium", claim === null ? "bg-accent text-accent-ink" : "bg-surface")}>
                    {t("auth.someoneElse")}
                  </button>
                </div>
              </div>
            )}
            {!claimed && (
              <>
                <Field label={t("auth.firstName")}>
                  <input className={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={t("auth.firstNamePh")} maxLength={40} autoComplete="given-name" />
                </Field>
                <Field label={t("auth.callName")} hint={t("auth.callNameHint")}>
                  <input className={input} value={callName} onChange={(e) => setCallName(e.target.value)} placeholder={t("auth.callNamePh")} maxLength={40} />
                </Field>
              </>
            )}
            <Field label={t("auth.city")} hint={t("auth.cityHint")}>
              <input className={input} value={city} onChange={(e) => setCity(e.target.value)} placeholder={t("auth.cityPh")} maxLength={60} autoComplete="address-level2" />
            </Field>
            {mode === "create" && (
              <Field label={t("auth.birthday")} hint={t("auth.birthdayHint")}>
                <div className="flex gap-2">
                  <select className={`${input} appearance-none`} value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t("auth.birthdayMonth")}>
                    <option value="">{t("auth.month")}</option>
                    {months.map((m, i) => (
                      <option key={m} value={String(i + 1).padStart(2, "0")}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select className={`${input} w-[120px] appearance-none`} value={day} onChange={(e) => setDay(e.target.value)} aria-label={t("auth.birthdayDay")}>
                    <option value="">{t("auth.day")}</option>
                    {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
                      <option key={d} value={d}>
                        {Number(d)}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
            )}
            {error && (
              <p className="m-0 mt-3 text-callout text-[#b42318]" role="alert">
                {error}
              </p>
            )}
            {alreadyIn && (
              <Link href="/" className="mt-2 inline-block text-callout font-semibold text-ink">
                {t("auth.openMyFamily")}
              </Link>
            )}
            <div className="flex-1" />
            <Button type="submit" className="mt-8 w-full" disabled={!detailsValid || busy}>
              {t("auth.continue")}
            </Button>
          </form>
        )}

        {step === "email" && (
          <form
            className="flex flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <p className="m-0 mt-2 text-body text-ink-soft">
              {mode === "signin" ? t("auth.emailSubSignin") : t("auth.emailSub")}
              {mode === "join" ? ` ${t("auth.emailSubJoin")}` : ""}
            </p>
            {ways.google && (
              <>
                <button type="button" onClick={() => void google()} disabled={busy} className="press mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[var(--line)] bg-white text-body font-semibold text-ink">
                  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.4 17.7 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
                    <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.8-6z" />
                    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-3.9-13.6-9.5l-7.8 6C6.6 42.6 14.6 48 24 48z" />
                  </svg>
                  {t("auth.google")}
                </button>
                <p className="m-0 mt-4 text-center text-footnote text-ink-soft">{t("auth.or")}</p>
              </>
            )}
            {byPhone ? (
              <Field label={t("auth.phone")}>
                <input className={input} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" dir="ltr" autoFocus />
              </Field>
            ) : (
              <Field label={t("auth.email")}>
                <input className={input} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.emailPh")} dir="ltr" autoFocus={!ways.google} />
              </Field>
            )}
            {ways.phone && (
              <button type="button" onClick={() => setByPhone((v) => !v)} className="mt-3 self-start text-callout font-medium text-ink-soft underline-offset-2 hover:underline">
                {byPhone ? t("auth.useEmail") : t("auth.usePhone")}
              </button>
            )}
            {ways.live && !byPhone && <p className="m-0 mt-2 text-footnote text-ink-faint">{t("auth.magicLink")}</p>}
            {error && (
              <p className="m-0 mt-3 text-callout text-[#b42318]" role="alert">
                {error}
              </p>
            )}
            <div className="flex-1" />
            <Button type="submit" className="mt-8 w-full" disabled={busy || (byPhone ? phone.replace(/\D/g, "").length < 8 : !/^\S+@\S+\.\S+$/.test(email))}>
              {busy ? t("auth.sending") : t("auth.sendCode")}
            </Button>
          </form>
        )}

        {step === "code" && (
          <div className="flex flex-1 flex-col">
            <p className="m-0 mt-2 text-body text-ink-soft">
              {t.rich("auth.codeSub", { email: <span className="font-semibold text-ink" dir="ltr">{byPhone ? phone : email}</span> })}
            </p>
            {mock && <p className="m-0 mt-2 rounded-[16px] bg-surface px-4 py-2.5 text-callout text-ink-soft">{t("auth.codeMock")}</p>}
            <label className="mt-6 block">
              <span className="sr-only">{t("auth.codeLabel")}</span>
              <input
                ref={codeRef}
                value={code}
                inputMode="numeric"
                dir="ltr"
                autoComplete="one-time-code"
                maxLength={6}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                  if (v.length === 6) void verify(v);
                }}
                className="tnum h-[64px] w-full rounded-[20px] bg-surface text-center text-display font-bold tracking-[0.5em] outline-none focus:ring-2 focus:ring-black/15"
                placeholder="······"
              />
            </label>
            {error && (
              <p className="m-0 mt-3 text-callout text-[#b42318]" role="alert">
                {error}
              </p>
            )}
            <button type="button" onClick={() => void sendCode()} disabled={busy} className="mt-3 h-11 self-center text-body font-medium text-ink-soft">
              {t("auth.resend")}
            </button>
            <div className="flex-1" />
            <Button className="mt-8 w-full" disabled={busy || code.length !== 6} onClick={() => void verify()}>
              {busy ? t("auth.checking") : mode === "create" ? t("auth.openOurs") : mode === "join" ? t("auth.joinCta") : t("landing.signin")}
            </Button>
          </div>
        )}

        {step === "nofamily" && (
          <div className="flex flex-1 flex-col gap-3">
            <Link href="/create" className="press mt-6 flex h-12 items-center justify-center rounded-full bg-accent text-body font-semibold text-accent-ink no-underline">
              {t("auth.startFamily")}
            </Link>
            <Link href="/join" className="press flex h-12 items-center justify-center rounded-full bg-tint text-body font-semibold text-ink no-underline">
              {t("landing.join")}
            </Link>
          </div>
        )}

        {step === "other-side" && (
          <OtherSide
            onDone={async (names) => {
              setFarNames(names);
              const out = await postJson<{ invite: { code: string } }>("/api/invites", {});
              setInvite(out?.invite.code ?? null);
              setStep("invite");
            }}
            onSkip={enter}
          />
        )}

        {step === "invite" && <InviteStep code={invite} names={farNames} from={callName.trim() || firstName.trim()} onDone={enter} />}
      </div>
    </div>
  );
}

type They = "parents" | "children" | "other";
const THEY: { id: They; label: UiKey }[] = [
  { id: "parents", label: "other.parents" },
  { id: "children", label: "other.children" },
  { id: "other", label: "other.other" },
];

/** Add the home on the other side: 1–n people, any roles, each with a call name and city. */
function OtherSide({ onDone, onSkip }: { onDone: (names: string[]) => Promise<void>; onSkip: () => void }) {
  const t = useT();
  const [they, setThey] = useState<They>("parents");
  const [people, setPeople] = useState<{ callName: string; city: string }[]>([{ callName: "", city: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = people.filter((p) => p.callName.trim());
  const set = (i: number, patch: Partial<{ callName: string; city: string }>) => setPeople((ps) => ps.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready.length || busy) return;
        setBusy(true);
        setError(null);
        // Everyone in one home shares a city: fill blanks from the first one given.
        const shared = ready.find((p) => p.city.trim())?.city.trim() ?? "";
        const out = await postJson<{ members: { displayName: string }[] }>("/api/members/other-side", { they, people: ready.map((p) => ({ callName: p.callName.trim(), city: p.city.trim() || shared })) });
        if (!out) {
          setBusy(false);
          setError(t("other.error"));
          return;
        }
        await onDone(out.members.map((m) => m.displayName));
      }}
    >
      <p className="m-0 mt-2 text-body text-ink-soft">{t("other.sub")}</p>
      <div className="mt-4 flex gap-2" role="radiogroup" aria-label={t("other.theyAre")}>
        {THEY.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={they === o.id} onClick={() => setThey(o.id)} className={cn("press min-h-10 flex-1 rounded-full px-2 py-1.5 text-callout font-medium leading-tight", they === o.id ? "bg-accent text-accent-ink" : "bg-surface")}>
            {t(o.label)}
          </button>
        ))}
      </div>
      <ul className="m-0 mt-2 list-none space-y-3 p-0">
        {people.map((p, i) => (
          <li key={i} className="flex items-end gap-2">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
              <Field label={i === 0 ? t("other.calledFirst") : t("other.calledMore")}>
                <input className={input} value={p.callName} onChange={(e) => set(i, { callName: e.target.value.slice(0, 40) })} placeholder={they === "children" ? t("other.childPh") : i === 0 ? t("other.parentPh1") : t("other.parentPh2")} aria-label={t("other.personName", { n: i + 1 })} />
              </Field>
              <Field label={i === 0 ? t("other.city") : " "}>
                <input className={input} value={p.city} onChange={(e) => set(i, { city: e.target.value.slice(0, 60) })} placeholder={i === 0 ? t("other.cityPh") : t("other.sameCity")} aria-label={t("other.personCity", { n: i + 1 })} />
              </Field>
            </div>
            {people.length > 1 && (
              <button type="button" aria-label={t("other.remove", { n: i + 1 })} onClick={() => setPeople((ps) => ps.filter((_, n) => n !== i))} className="press mb-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-soft">
                <Icon name="close" size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {people.length < 6 && (
        <button type="button" onClick={() => setPeople((ps) => [...ps, { callName: "", city: "" }])} className="press mt-3 flex h-11 items-center justify-center gap-2 self-start rounded-full bg-surface px-4 text-body font-medium">
          <Icon name="plus" size={18} />
          {t("other.add")}
        </button>
      )}
      {error && (
        <p className="m-0 mt-3 text-callout text-[#b42318]" role="alert">
          {error}
        </p>
      )}
      <div className="flex-1" />
      <Button type="submit" className="mt-8 w-full" disabled={busy || ready.length === 0}>
        {busy ? t("other.adding") : t("auth.continue")}
      </Button>
      <Button variant="quiet" className="mt-1 w-full" onClick={onSkip}>
        {t("other.later")}
      </Button>
    </form>
  );
}

/** One tap: WhatsApp the join link and code. */
function InviteStep({ code, names, from, onDone }: { code: string | null; names: string[]; from: string; onDone: () => void }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const t = useT();
  useEffect(() => setOrigin(window.location.origin), []);
  if (!code) {
    return (
      <div className="flex flex-1 flex-col">
        <p className="m-0 mt-2 text-body text-ink-soft">{t("invite.failed")}</p>
        <div className="flex-1" />
        <Button className="mt-8 w-full" onClick={onDone}>
          {t("invite.openWindow")}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col">
      <p className="m-0 mt-2 text-body text-ink-soft">{t("invite.sub")}</p>
      <p data-display dir="ltr" className="tnum m-0 mt-6 rounded-[22px] bg-surface py-4 text-center text-display font-bold tracking-[0.12em]">{code}</p>
      <p className="m-0 mt-2 text-center text-footnote text-ink-faint">{t("invite.valid")}</p>
      <div className="flex-1" />
      <a href={whatsappInvite(origin, code, from || undefined)} target="_blank" rel="noopener noreferrer" className="press mt-8 flex h-12 items-center justify-center gap-2 rounded-full bg-accent text-body font-semibold text-accent-ink no-underline">
        <Icon name="whatsapp" size={20} />
        {t("invite.whatsapp")}
      </a>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(joinLink(origin, code));
            setCopied(true);
          } catch {
            /* no clipboard */
          }
        }}
        className="press mt-2 flex h-11 items-center justify-center gap-2 rounded-full text-body font-medium text-ink-soft"
      >
        <Icon name={copied ? "check" : "share"} size={18} />
        {copied ? t("invite.copied") : t("invite.copy")}
      </button>
      <Button variant="secondary" className="mt-2 w-full" onClick={onDone}>
        {names.length ? t("invite.openMine") : t("invite.done")}
      </Button>
    </div>
  );
}
