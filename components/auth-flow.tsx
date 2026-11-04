"use client";

import { Lockup } from "./brand";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { codeFromInput, joinLink, whatsappInvite } from "@/lib/invite-link";
import { resetFamilyCards } from "@/lib/use-family";
import { postJson } from "@/lib/use-json";
import { useDocumentLang, useT, type T } from "@/lib/use-t";
import { en, htmlLang, type UiKey } from "@/lib/ui-strings/lazy";
import { cn } from "@/lib/utils";
import { AUTH_INTENT_KEY, browserAuth, signInOptions } from "@/lib/supabase-browser";
import { signOutNow } from "@/lib/sign-out";
import { afterSignin, currentSession, legacySigninRedirect, signinShortcut, suggestedNames, verifyAccessToken, type VerifyOutcome } from "@/lib/auth-session";
import { authRedirectUrl, isNative, openExternal } from "@/lib/native";
import { useShell } from "./shell";
import { Button, Icon } from "./ui/kit";

// One door for everyone. Sign in with Google or an email code; a family you have opens. No family
// yet: one short "Set up your family" screen (or paste an invite link there). A family link
// (/join/<CODE>) does it all on one page: who's inviting you, the same sign-in buttons, "Which one
// are you?", and in. Already signed in to another family: "Join this one too?".

type Stage = "loading" | "auth" | "code" | "setup" | "pick" | "confirm" | "dead" | "full" | "limit" | "paste" | "other-side" | "invite";

/** Who proved who they are but has no family yet: what the next verify call carries. */
type Identity = { kind: "supabase"; token: string; email: string; name: string } | { kind: "code"; email: string; code: string };

interface You {
  name: string;
  email: string | null;
  current: string;
  inFamily: boolean;
  familyId?: string;
  sides: number;
  maxSides: number;
  canJoin: boolean;
}
interface Peek {
  family: string;
  host: string | null;
  places: { id: string; callName: string }[];
  full: boolean;
  you?: You;
}
type PeekResult = { ok: true; peek: Peek } | { ok: false; host: string | null; family: string | null };

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

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="m-0 mt-3 text-callout text-[#b42318]" role="alert">
      {text}
    </p>
  );
}

const input = "h-12 w-full rounded-full bg-surface px-5 text-body outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-black/15";

async function peekInvite(code: string): Promise<PeekResult> {
  try {
    const res = await fetch(`/api/invites/peek?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as Partial<Peek> & { host?: string | null; family?: string };
    if (res.ok) return { ok: true, peek: data as Peek };
    return { ok: false, host: data.host ?? null, family: data.family ?? null };
  } catch {
    return { ok: false, host: null, family: null };
  }
}

export function AuthFlow({ join = false, code: codeProp = null }: { join?: boolean; code?: string | null }) {
  const router = useRouter();
  const t = useT();
  useDocumentLang();
  const { setChromeHidden } = useShell();
  const [stage, setStage] = useState<Stage>("loading");
  const [joinCode, setJoinCodeState] = useState<string | null>(codeProp ? codeProp.toUpperCase() : null);
  // The link being joined, read by handlers that a first-render closure holds (the start-up effect).
  const linkRef = useRef<string | null>(joinCode);
  const setJoinCode = (c: string | null) => {
    linkRef.current = c;
    setJoinCodeState(c);
  };
  const [peek, setPeek] = useState<Peek | null>(null);
  const [dead, setDead] = useState<{ host: string | null; family: string | null }>({ host: null, family: null });
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [firstName, setFirstName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [someoneElse, setSomeoneElse] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [byPhone, setByPhone] = useState(false);
  const [otp, setOtp] = useState("");
  const ways = signInOptions();
  const [mock, setMock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [farNames, setFarNames] = useState<string[]>([]);
  const codeRef = useRef<HTMLInputElement>(null);
  const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    setChromeHidden(true);
    return () => setChromeHidden(false);
  }, [setChromeHidden]);
  useEffect(() => {
    if (stage === "code") codeRef.current?.focus();
  }, [stage]);

  const enter = () => {
    resetFamilyCards();
    try {
      sessionStorage.setItem("aangan:entered", "1"); // just signed in: straight into the app, never the home page
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("aangan:auth"));
    router.replace("/");
  };
  const keepWelcome = (welcome?: string) => {
    if (!welcome) return;
    try {
      sessionStorage.setItem("aangan:welcome", welcome);
    } catch {
      /* private mode */
    }
  };

  const prefill = (name: string, mail: string) => {
    const s = suggestedNames(name, mail);
    setFirstName((v) => v || s.firstName);
    setFamilyName((v) => v || s.familyName);
  };

  /** With a link in hand and what the page now knows about you: open it, ask, or show why not. */
  const routeJoin = (p: Peek, id: Identity | null) => {
    setPeek(p);
    setBusy(false);
    if (p.you?.canJoin) {
      if (p.you.inFamily && p.you.familyId) {
        // Already one of them: just open it.
        void postJson("/api/sides", { action: "switch", familyId: p.you.familyId }).then(enter);
        return;
      }
      if (p.you.sides >= p.you.maxSides) return setStage("limit");
      if (p.full && !p.places.length) return setStage("full");
      return setStage("confirm");
    }
    if (p.full && !p.places.length) return setStage("full");
    setStage(id ? "pick" : "auth");
  };

  const openLink = async (code: string, id: Identity | null) => {
    setJoinCode(code);
    const out = await peekInvite(code);
    if (!out.ok) {
      setDead({ host: out.host, family: out.family });
      setBusy(false);
      return setStage("dead");
    }
    routeJoin(out.peek, id);
  };

  /** Just proved who they are: a family opens (or the link is next); no family yet, setup or "which one are you". */
  const afterIdentity = async (id: Identity) => {
    setBusy(true);
    setError(null);
    const base = { tz: tz(), intent: { type: "signin" } };
    let out: VerifyOutcome;
    const sb = browserAuth();
    if (id.kind === "supabase" && sb) {
      out = await verifyAccessToken(sb, { accessToken: id.token, ...base }, (e) => e === "no-family");
    } else if (id.kind === "code") {
      try {
        const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: id.email, code: id.code, ...base }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string; welcome?: string; status?: string };
        out = res.ok ? { ok: true, welcome: data.welcome, status: data.status } : { ok: false, error: data.error ?? "failed" };
      } catch {
        out = { ok: false, error: "failed" };
      }
    } else out = { ok: false, error: "failed" };
    const next = afterSignin(out);
    if (next.kind === "failed") {
      setBusy(false);
      setError(errorText(t, next.error));
      if (next.error === "wrong-code") {
        setOtp("");
        setIdentity(null);
        setStage(id.kind === "code" ? "code" : "auth");
      } else setStage("auth");
      return;
    }
    if (next.kind === "enter") {
      keepWelcome(out.ok ? out.welcome : undefined);
      // Signed in to your family; a link opens next ("Join this one too?", or it's already yours).
      if (linkRef.current) return openLink(linkRef.current, null);
      return enter();
    }
    setIdentity(id);
    prefill(id.kind === "supabase" ? id.name : "", id.email);
    if (linkRef.current) return openLink(linkRef.current, id);
    setBusy(false);
    setStage("setup");
  };

  // Where the page starts: a link, an old ?next= URL, a session that's already here, or the buttons.
  useEffect(() => {
    let alive = true;
    let fullNoPlaces = false;
    void (async () => {
      const q = new URLSearchParams(window.location.search);
      if (q.get("expired")) setError(errorText(t, "session-expired"));
      if (!join) {
        const legacy = legacySigninRedirect(window.location.search);
        if (legacy) return router.replace(legacy);
      }
      const code = linkRef.current ?? (join ? codeFromInput(q.get("code") ?? "") : null);
      if (join && !code) return setStage("paste");
      if (code) {
        setJoinCode(code);
        const out = await peekInvite(code);
        if (!alive) return;
        if (!out.ok) {
          setDead({ host: out.host, family: out.family });
          return setStage("dead");
        }
        // Signed in to Nearer already: no sign-in at all.
        if (out.peek.you?.canJoin) return routeJoin(out.peek, null);
        setPeek(out.peek);
        fullNoPlaces = out.peek.full && out.peek.places.length === 0;
      } else if (browserAuth()) {
        // Signed in to Nearer already and nothing else to do: no reason to sign in again.
        const me = await fetch("/api/session", { cache: "no-store" })
          .then(async (res) => (res.ok ? ((await res.json()) as { status?: string }) : null))
          .catch(() => null);
        if (!alive) return;
        if (signinShortcut({ sessionOk: Boolean(me), status: me?.status }) === "home") return router.replace("/");
      }
      // Back from Google (or a link with a session kept): carry on with who they are.
      const sb = browserAuth();
      const sess = sb ? await currentSession(sb) : null;
      if (!alive) return;
      if (sess) return afterIdentity({ kind: "supabase", token: sess.token, email: sess.email, name: sess.name });
      setStage(fullNoPlaces ? "full" : "auth");
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phoneE164 = () => `+${phone.replace(/\D/g, "")}`;
  /** Kept across a Google redirect: the link being joined, if any. */
  const saveIntent = () => {
    try {
      const saved = JSON.stringify(linkRef.current ? { joinCode: linkRef.current } : {});
      sessionStorage.setItem(AUTH_INTENT_KEY, saved);
      localStorage.setItem(AUTH_INTENT_KEY, saved);
    } catch {
      /* private mode: the callback falls back to sign-in */
    }
  };
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
        setStage("code");
        return;
      }
      const res = await fetch("/api/auth/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const data = (await res.json()) as { error?: string; mock?: boolean };
      if (!res.ok) throw new Error(data.error ?? "code-not-sent");
      setMock(Boolean(data.mock));
      setStage("code");
    } catch (e) {
      setError(errorText(t, (e as Error).message));
    } finally {
      setBusy(false);
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
  const checkCode = async (value = otp) => {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    const sb = browserAuth();
    if (!sb) return afterIdentity({ kind: "code", email, code: value });
    const out = byPhone ? await sb.auth.verifyOtp({ phone: phoneE164(), token: value, type: "sms" }) : await sb.auth.verifyOtp({ email, token: value, type: "email" });
    const token = out.data.session?.access_token;
    if (out.error || !token) {
      setBusy(false);
      setOtp("");
      return setError(errorText(t, "wrong-code"));
    }
    const meta = out.data.session?.user?.user_metadata ?? {};
    await afterIdentity({ kind: "supabase", token, email: out.data.session?.user?.email ?? email, name: typeof meta.full_name === "string" ? meta.full_name : "" });
  };

  /** The second (and last) verify for someone new: make the family, or join the linked one. */
  const finish = async (intent: Record<string, unknown>, birthday?: string): Promise<VerifyOutcome> => {
    const id = identity;
    const base = { tz: tz(), intent, ...(birthday ? { birthday } : {}) };
    const sb = browserAuth();
    // A fixable error (a name, a full family) keeps the Supabase session for another try; a rejected token drops it.
    if (id?.kind === "supabase" && sb) return verifyAccessToken(sb, { accessToken: id.token, ...base }, (e) => e !== "wrong-code");
    if (id?.kind === "code") {
      try {
        const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: id.email, code: id.code, ...base }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string; welcome?: string; status?: string; existing?: boolean };
        return res.ok ? { ok: true, welcome: data.welcome, status: data.status, ...(data.existing ? { existing: true } : {}) } : { ok: false, error: data.error ?? "failed" };
      } catch {
        return { ok: false, error: "failed" };
      }
    }
    return { ok: false, error: "wrong-code" };
  };
  /** The proof didn't hold (a Supabase session that ran out): back to the buttons. */
  const lostIdentity = () => {
    setIdentity(null);
    setStage("auth");
    setError(errorText(t, "session-expired"));
  };

  const createFamily = async () => {
    setBusy(true);
    setError(null);
    const out = await finish({ type: "create", familyName: familyName.trim(), firstName: firstName.trim() }, month && day ? `${month}-${day}` : undefined);
    setBusy(false);
    if (!out.ok) return out.error === "wrong-code" ? lostIdentity() : setError(errorText(t, out.error));
    keepWelcome(out.welcome);
    // Already had a family: the server opened it instead of making a second one.
    if (out.existing) return enter();
    setStage("other-side");
  };

  const joinFamily = async (claimMemberId?: string) => {
    if (!joinCode) return;
    setBusy(true);
    setError(null);
    const out = await finish({ type: "join", inviteCode: joinCode, ...(claimMemberId ? { claimMemberId } : { firstName: firstName.trim() }) });
    if (!out.ok) {
      setBusy(false);
      if (out.error === "wrong-code") return lostIdentity();
      if (out.error === "invalid-invite") return setStage("dead");
      return setError(out.error === "family-full" && peek ? t("auth.fullTitle", { family: peek.family }) : errorText(t, out.error));
    }
    keepWelcome(out.welcome);
    enter();
  };

  /** Signed in to another family: join this one too, with the session already here. */
  const joinToo = async (claimMemberId?: string) => {
    if (!joinCode) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invites/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: joinCode, ...(claimMemberId ? { claimMemberId } : {}) }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; welcome?: string };
      if (!res.ok) {
        setBusy(false);
        if (data.error === "invalid-invite") return setStage("dead");
        return setError(data.error === "family-full" && peek ? t("auth.fullTitle", { family: peek.family }) : errorText(t, data.error ?? "failed"));
      }
      keepWelcome(data.welcome);
      enter();
    } catch {
      setBusy(false);
      setError(errorText(t, "failed"));
    }
  };

  const here = () => (joinCode ? `/join/${encodeURIComponent(joinCode)}` : "/signin");
  /** "Not you?": everything about the last person goes, then back to this same page. */
  const notYou = () => {
    setIdentity(null);
    if (identity?.kind === "code") {
      setStage("auth");
      return;
    }
    void signOutNow(here());
  };

  const back = () => {
    setError(null);
    if (stage === "other-side" || stage === "invite") enter();
    else if (stage === "code") setStage("auth");
    else if (stage === "auth" && pasteOpen) setPasteOpen(false);
    else router.push("/");
  };

  const pasteSubmit = async () => {
    const code = codeFromInput(paste);
    if (!code) return setError(t("auth.badLink"));
    setError(null);
    setBusy(true);
    if (join && !identity) {
      // The /join page with nothing signed in yet: the link's own page.
      router.replace(`/join/${encodeURIComponent(code)}`);
      await openLink(code, null);
      return;
    }
    await openLink(code, identity);
  };

  const months = monthNames(htmlLang(t.lang));
  const joining = Boolean(joinCode && peek);
  const signedInAs = stage === "confirm" || stage === "limit" ? peek?.you?.email || peek?.you?.name || null : identity ? identity.email || t("auth.signedInAsYou") : null;
  const title =
    stage === "other-side"
      ? t("auth.titleOtherSide")
      : stage === "invite"
        ? farNames.length
          ? t("auth.titleInvite", { names: farNames.join(t("auth.namesJoin")) })
          : t("auth.titleInviteThem")
        : stage === "code"
          ? t("auth.titleCheck")
          : stage === "setup"
            ? t("auth.setupTitle")
            : stage === "dead"
              ? t("auth.deadTitle")
              : stage === "full" && peek
                ? t("auth.fullTitle", { family: peek.family })
                : stage === "confirm" && peek
                    ? t("auth.joinToo", { family: peek.family })
                    : stage === "paste"
                      ? t("auth.titleJoin")
                      : joining && peek
                        ? t("auth.joinTitle", { family: peek.family })
                        : stage === "loading"
                          ? ""
                          : t("auth.welcome");

  const notYouLine = signedInAs && (
    <p className="m-0 mt-2 text-footnote text-ink-faint">
      {t("auth.signedInAs", { email: signedInAs })} ·{" "}
      <button type="button" onClick={notYou} className="press inline-flex min-h-11 items-center p-0 text-footnote font-medium text-ink-soft underline">
        {t("auth.notYou")}
      </button>
    </p>
  );
  const signInButton = (
    <a href="/signin" className="press mt-8 flex h-12 w-full items-center justify-center rounded-full bg-accent text-body font-semibold text-accent-ink no-underline">
      {t("landing.signin")}
    </a>
  );
  const nameField = (
    <Field label={t("auth.firstName")}>
      <input className={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={t("auth.firstNamePh")} maxLength={40} autoComplete="given-name" />
    </Field>
  );
  /** "Which one are you?": one tap on a place the family made, or "Someone else" and your name. */
  const picker = (onPick: (claim?: string) => void, nameNeeded: boolean) =>
    peek && peek.places.length > 0 ? (
      <div className="mt-4">
        <span className="mb-1.5 block text-footnote font-medium text-ink-soft">{t("auth.whichYou")}</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("auth.whichYou")}>
          {peek.places.map((p) => (
            <button key={p.id} type="button" disabled={busy} onClick={() => onPick(p.id)} className="press h-11 rounded-full bg-surface px-5 text-body font-semibold" data-ui="join-place">
              {t("auth.imName", { name: p.callName })}
            </button>
          ))}
          <button type="button" aria-pressed={someoneElse} onClick={() => setSomeoneElse((v) => !v)} className={cn("press h-11 rounded-full px-5 text-body font-medium", someoneElse ? "bg-accent text-accent-ink" : "bg-surface")} data-ui="join-someone-else">
            {t("auth.someoneElse")}
          </button>
        </div>
        {someoneElse && nameNeeded && nameField}
      </div>
    ) : nameNeeded ? (
      nameField
    ) : null;

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-white">
      <div className="mx-auto flex min-h-full max-w-[480px] flex-col px-4" style={{ paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}>
        <div className="flex items-center justify-between">
          <button type="button" onClick={back} aria-label={stage === "other-side" || stage === "invite" ? t("auth.skip") : t("auth.back")} className="press -ms-2 grid h-11 w-11 place-items-center rounded-full">
            <Icon name={stage === "other-side" || stage === "invite" ? "close" : "back"} className="rtl:-scale-x-100" />
          </button>
          <Lockup mark={24} word={72} className="text-ink" />
        </div>
        <h1 data-display className="m-0 mt-4 text-display leading-[1.08]">{title}</h1>

        {stage === "loading" && <div className="mt-6 flex-1 space-y-3" aria-busy="true"><div className="skeleton h-12 rounded-full" /><div className="skeleton h-12 rounded-full" /></div>}

        {stage === "auth" && (
          <form
            className="flex flex-1 flex-col"
            data-ui="signin-form"
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <p className="m-0 mt-2 text-body text-ink-soft">{joining && peek ? `${peek.host ? `${t("auth.invitedBy", { host: peek.host })} ` : ""}${t("auth.continueWith")}` : t("auth.welcomeSub")}</p>
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
              <button type="button" onClick={() => setByPhone((v) => !v)} className="mt-3 min-h-11 self-start text-callout font-medium text-ink-soft underline-offset-2 hover:underline">
                {byPhone ? t("auth.useEmail") : t("auth.usePhone")}
              </button>
            )}
            {ways.live && !byPhone && <p className="m-0 mt-2 text-footnote text-ink-faint">{t("auth.magicLink")}</p>}
            <ErrorLine text={error} />
            <div className="flex-1" />
            <Button type="submit" className="mt-8 w-full" disabled={busy || (byPhone ? phone.replace(/\D/g, "").length < 8 : !/^\S+@\S+\.\S+$/.test(email))}>
              {busy ? t("auth.sending") : t("auth.sendCode")}
            </Button>
          </form>
        )}

        {stage === "code" && (
          <div className="flex flex-1 flex-col">
            <p className="m-0 mt-2 text-body text-ink-soft">
              {t.rich("auth.codeSub", { email: <span className="font-semibold text-ink" dir="ltr">{byPhone ? phone : email}</span> })}
            </p>
            {mock && <p className="m-0 mt-2 rounded-[16px] bg-surface px-4 py-2.5 text-callout text-ink-soft">{t("auth.codeMock")}</p>}
            <label className="mt-6 block">
              <span className="sr-only">{t("auth.codeLabel")}</span>
              <input
                ref={codeRef}
                value={otp}
                inputMode="numeric"
                dir="ltr"
                autoComplete="one-time-code"
                maxLength={6}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setOtp(v);
                  if (v.length === 6) void checkCode(v);
                }}
                className="tnum h-[64px] w-full rounded-[20px] bg-surface text-center text-display font-bold tracking-[0.5em] outline-none focus:ring-2 focus:ring-black/15"
                placeholder="······"
              />
            </label>
            <ErrorLine text={error} />
            <button type="button" onClick={() => void sendCode()} disabled={busy} className="mt-3 h-11 self-center text-body font-medium text-ink-soft">
              {t("auth.resend")}
            </button>
            <div className="flex-1" />
            <Button className="mt-8 w-full" disabled={busy || otp.length !== 6} onClick={() => void checkCode()}>
              {busy ? t("auth.checking") : t("auth.continue")}
            </Button>
          </div>
        )}

        {stage === "setup" && (
          <form
            className="flex flex-1 flex-col"
            data-ui="setup-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (firstName.trim() && familyName.trim()) void createFamily();
            }}
          >
            {notYouLine}
            <Field label={t("auth.firstName")}>
              <input className={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={t("auth.firstNamePh")} maxLength={40} autoComplete="given-name" autoFocus={!firstName} />
            </Field>
            <Field label={t("auth.familyName")}>
              <input className={input} value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder={t("auth.familyNamePh")} maxLength={40} />
            </Field>
            <Field label={t("auth.birthdayOptional")} hint={t("auth.birthdayHint")}>
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
            <ErrorLine text={error} />
            <div className="flex-1" />
            <Button type="submit" className="mt-8 w-full" disabled={busy || !firstName.trim() || !familyName.trim()}>
              {busy ? t("auth.creating") : t("auth.createFamily")}
            </Button>
            {pasteOpen ? (
              <div className="mt-4" data-ui="paste-link">
                <Field label={t("auth.pasteLabel")}>
                  <input
                    className={input}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      void pasteSubmit();
                    }}
                    placeholder={t("auth.pastePh")}
                    dir="ltr"
                    autoFocus
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                </Field>
                <Button type="button" variant="secondary" className="mt-3 w-full" disabled={busy || !paste.trim()} onClick={() => void pasteSubmit()}>
                  {t("auth.openLink")}
                </Button>
              </div>
            ) : (
              <button type="button" onClick={() => setPasteOpen(true)} className="press mt-2 flex min-h-11 items-center justify-center text-callout font-medium text-ink-soft underline underline-offset-2" data-ui="paste-open">
                {t("auth.havePaste")}
              </button>
            )}
          </form>
        )}

        {stage === "pick" && peek && (
          <form
            className="flex flex-1 flex-col"
            data-ui="join-pick"
            onSubmit={(e) => {
              e.preventDefault();
              if (firstName.trim()) void joinFamily();
            }}
          >
            {peek.host && <p className="m-0 mt-2 text-body text-ink-soft">{t("auth.invitedBy", { host: peek.host })}</p>}
            {notYouLine}
            {picker((claim) => void joinFamily(claim), true)}
            <ErrorLine text={error} />
            <div className="flex-1" />
            {(peek.places.length === 0 || someoneElse) && (
              <Button type="submit" className="mt-8 w-full" disabled={busy || !firstName.trim()}>
                {busy ? t("auth.checking") : t("auth.joinCta")}
              </Button>
            )}
          </form>
        )}

        {stage === "confirm" && peek?.you && (
          <div className="flex flex-1 flex-col" data-ui="join-confirm">
            <p className="m-0 mt-2 text-body text-ink-soft">{t("auth.keepCurrent", { current: peek.you.current })}</p>
            {notYouLine}
            {peek.places.length > 0 && picker((claim) => void joinToo(claim), false)}
            <ErrorLine text={error} />
            <div className="flex-1" />
            <Button className="mt-8 w-full" disabled={busy} onClick={() => void joinToo()}>
              {busy ? t("auth.checking") : t("auth.joinCta")}
            </Button>
            <Button variant="quiet" className="mt-1 w-full" onClick={enter}>
              {t("auth.notNow")}
            </Button>
          </div>
        )}

        {stage === "limit" && peek?.you && (
          <div className="flex flex-1 flex-col" data-ui="join-limit">
            <p className="m-0 mt-2 text-body text-ink-soft">{t("families.limit", { n: peek.you.maxSides })}</p>
            {notYouLine}
            <div className="flex-1" />
            <Button className="mt-8 w-full" onClick={enter}>
              {t("auth.openMyFamily")}
            </Button>
          </div>
        )}

        {stage === "dead" && (
          <div className="flex flex-1 flex-col" data-ui="join-dead">
            <p className="m-0 mt-2 text-body text-ink-soft">{dead.host ? t("auth.deadHost", { host: dead.host }) : t("auth.deadNoHost")}</p>
            <div className="flex-1" />
            {signInButton}
          </div>
        )}

        {stage === "full" && (
          <div className="flex flex-1 flex-col" data-ui="join-full">
            <p className="m-0 mt-2 text-body text-ink-soft">{t("auth.fullSub")}</p>
            <div className="flex-1" />
            {signInButton}
          </div>
        )}

        {stage === "paste" && (
          <form
            className="flex flex-1 flex-col"
            data-ui="paste-link"
            onSubmit={(e) => {
              e.preventDefault();
              void pasteSubmit();
            }}
          >
            <p className="m-0 mt-2 text-body text-ink-soft">{t("auth.pasteSub")}</p>
            <Field label={t("auth.pasteLabel")}>
              <input className={input} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={t("auth.pastePh")} dir="ltr" autoFocus autoCapitalize="off" autoCorrect="off" />
            </Field>
            <ErrorLine text={error} />
            <div className="flex-1" />
            <Button type="submit" className="mt-8 w-full" disabled={busy || !paste.trim()}>
              {t("auth.openLink")}
            </Button>
          </form>
        )}

        {stage === "other-side" && (
          <OtherSide
            onDone={async (names) => {
              setFarNames(names);
              const out = await postJson<{ invite: { code: string } }>("/api/invites", {});
              setInvite(out?.invite.code ?? null);
              setStage("invite");
            }}
            onSkip={enter}
          />
        )}

        {stage === "invite" && <InviteStep code={invite} names={farNames} from={firstName.trim()} onDone={enter} />}
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
      <p dir="ltr" className="m-0 mt-6 break-all rounded-[22px] bg-surface px-4 py-4 text-center text-headline font-semibold" data-ui="invite-link">{origin ? joinLink(origin, code).replace(/^https?:\/\//, "") : code}</p>
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
