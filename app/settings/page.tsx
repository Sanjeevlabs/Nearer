"use client";

import Link from "next/link";
import { useJson } from "@/lib/use-json";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar, Button, Icon, Photo, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { type SupportedLang } from "@/lib/i18n";
import { LANGUAGES, language } from "@/lib/languages";
import { ZONES, placeFromTz } from "@/lib/zones";
import { processHomeImage } from "@/lib/media-client";
import { resolveMediaUrl } from "@/lib/media-session";
import { memberPhoto } from "@/lib/people";
import { resetFamilyCards } from "@/lib/use-family";
import { useLargeText } from "@/lib/use-large-text";
import { ACCESS_LABEL, ACCESS_ORDER, can, isGrownUp } from "@/lib/permissions";
import type { Member } from "@/lib/schemas";
import { callName } from "@/lib/people";
import { cn } from "@/lib/utils";
import { WindowSettings } from "@/components/window-settings";
import { WindowOptions } from "./window-options";
import { ConnectedApps } from "@/components/connected-apps";
import { useDocumentLang, useT } from "@/lib/use-t";
import { ensureCatalogue, hasUiCatalogue, translate } from "@/lib/ui-strings/lazy";

interface Invite {
  code: string;
  expiresAt: string;
}

const ROLE_ERROR: Record<string, string> = {
  "admins-full": "A family can have up to 3 admins, the owner included.",
  "needs-parent": "Only their parent can make this a teen account.",
  "has-account": "They have their own account, so they can't be a child profile.",
  "owner-use-transfer": "Hand the family over to change the owner's role.",
  "needs-account": "They need their own account before they can own the family.",
  "family-full": "A family can have up to 50 people.",
  "grown-ups-only": "Only a grown-up can own the family.",
};

/** Joiners waiting for an owner/admin, at the top of the Family tab. */
function WaitingToJoin({ onMessage }: { onMessage: (m: string) => void }) {
  const { viewer, refreshMembers } = useViewer();
  const allowed = can(viewer, "members.approve");
  const { data, failed, reload } = useJson<{ pending: Member[] }>(allowed ? "/api/members" : null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!allowed) return null;
  if (failed) return <p className="m-0 mt-6 rounded-[22px] bg-surface p-4 text-[14px] text-ink-soft">Couldn&rsquo;t check who&rsquo;s waiting. Pull to try again.</p>;
  if (!data) return <div className="mt-6 h-[72px] animate-pulse rounded-[22px] bg-surface" aria-busy="true" aria-label="Checking who's waiting" />;
  if (data.pending.length === 0) return null;
  const decide = async (m: Member, decision: "approve" | "decline") => {
    if (decision === "decline" && !window.confirm(`Decline ${callName(m)}? Their place will be removed.`)) return;
    setBusy(m.id);
    const res = await fetch(`/api/members/${encodeURIComponent(m.id)}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(null);
    if (res?.ok) onMessage(decision === "approve" ? `${callName(m)} is in.` : `${callName(m)} was declined.`);
    else onMessage(ROLE_ERROR[body?.error ?? ""] ?? "Couldn't do that. Try again.");
    await Promise.all([reload(), refreshMembers()]);
  };
  return (
    <section aria-label="Waiting to join" className="mt-9">
      <h2 className="m-0 mb-3 text-[20px]">Waiting to join</h2>
      <ul className="m-0 list-none divide-y divide-[var(--line)] rounded-[22px] bg-surface p-0 px-4">
        {data.pending.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-3">
            <Avatar src={memberPhoto(m)} name={callName(m)} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-semibold">{callName(m)}</span>
              <span className="block text-[13px] text-ink-soft">{m.city ? `Joined with a code · ${m.city}` : "Joined with a code"}</span>
            </span>
            <button type="button" aria-label={`Decline ${callName(m)}`} disabled={busy === m.id} onClick={() => void decide(m, "decline")} className="press grid h-11 w-11 place-items-center rounded-full bg-white text-ink disabled:opacity-40">
              <Icon name="close" size={20} />
            </button>
            <button type="button" aria-label={`Let ${callName(m)} in`} disabled={busy === m.id} onClick={() => void decide(m, "approve")} className="press grid h-11 w-11 place-items-center rounded-full bg-ink text-white disabled:opacity-40">
              <Icon name="check" size={20} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Who's who, and (for owners/admins) who may do what: one chip per role. */
function PeopleAndRoles({ onMessage }: { onMessage: (m: string) => void }) {
  const { viewer, members, refreshMembers } = useViewer();
  const admin = can(viewer, "roles.assign");
  const owner = can(viewer, "owner.transfer");
  const [busy, setBusy] = useState<string | null>(null);
  const rank = (a: Member["access"]) => ACCESS_ORDER.indexOf(a);
  const people = [...members].sort((a, b) => rank(a.access) - rank(b.access) || callName(a).localeCompare(callName(b)));
  const send = async (m: Member, url: string, init: RequestInit, ok: string) => {
    setBusy(m.id);
    const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(null);
    onMessage(res?.ok ? ok : (ROLE_ERROR[body?.error ?? ""] ?? "Couldn't change that. Try again."));
    await refreshMembers();
  };
  const pick = (m: Member, to: Member["access"]) => {
    if (to === m.access) return;
    if (to === "owner") {
      if (!window.confirm(`Hand the family over to ${callName(m)}? You'll stay an admin.`)) return;
      return void send(m, `/api/members/${encodeURIComponent(m.id)}/owner`, { method: "POST", body: "{}" }, `${callName(m)} owns the family now.`);
    }
    void send(m, `/api/members/${encodeURIComponent(m.id)}`, { method: "PATCH", body: JSON.stringify({ access: to }) }, `${callName(m)} is now ${ACCESS_LABEL[to].label.toLowerCase()}.`);
  };
  const remove = (m: Member) => {
    if (!window.confirm(`Remove ${callName(m)} from the family? What they shared stays.`)) return;
    void send(m, `/api/members/${encodeURIComponent(m.id)}`, { method: "DELETE" }, `${callName(m)} was removed.`);
  };
  /** Chips this viewer may tap for this person. */
  const choices = (m: Member): Member["access"][] => {
    if (!admin || m.access === "owner") return [];
    return ACCESS_ORDER.filter((a) => (a === "owner" ? owner && (m.access === "admin" || m.access === "member") : a === "child" ? !m.email : true));
  };
  return (
    <div>
      <ul className="m-0 list-none divide-y divide-[var(--line)] rounded-[22px] bg-surface p-0 px-4">
        {people.map((m) => {
          const options = choices(m);
          const removable = m.id !== viewer.id && m.access !== "owner" && can(viewer, m.email || m.access === "admin" || m.access === "teen" ? "tree.remove-account" : "tree.remove");
          return (
            <li key={m.id} className="py-3">
              <div className="flex items-center gap-3">
                <Avatar src={memberPhoto(m)} name={callName(m)} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold">
                    {callName(m)}
                    {m.id === viewer.id ? " (you)" : ""}
                  </span>
                  <span className="block text-[13px] text-ink-soft">{m.email ? "Has their own account" : "Added by family"}</span>
                </span>
                {options.length === 0 && <span className="rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold">{ACCESS_LABEL[m.access].label}</span>}
                {removable && (
                  <button type="button" aria-label={`Remove ${callName(m)}`} disabled={busy === m.id} onClick={() => remove(m)} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-soft disabled:opacity-40">
                    <Icon name="trash" size={18} />
                  </button>
                )}
              </div>
              {options.length > 0 && (
                <div role="radiogroup" aria-label={`${callName(m)}'s role`} className="no-scrollbar -mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1">
                  {options.map((a) => {
                    const on = a === m.access;
                    return (
                      <button
                        key={a}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={busy === m.id}
                        onClick={() => pick(m, a)}
                        className={cn("press h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold disabled:opacity-40", on ? "bg-ink text-white" : "bg-white text-ink")}
                      >
                        {ACCESS_LABEL[a].label}
                      </button>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ul className="m-0 mt-3 list-none space-y-1 p-0 text-[13px] text-ink-soft">
        {ACCESS_ORDER.map((a) => (
          <li key={a}>
            <span className="font-semibold text-ink">{ACCESS_LABEL[a].label}</span> · {ACCESS_LABEL[a].note}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LargeTextToggle() {
  const { viewer } = useViewer();
  const [large, setLarge] = useLargeText(viewer.role === "elder");
  return (
    <label className="flex items-center justify-between gap-3 rounded-[20px] bg-surface px-4 py-3.5">
      <span>
        <span className="block text-[17px] font-semibold">Larger text</span>
        <span className="block text-[14px] text-ink-soft">Bigger words and buttons, easier on the eyes</span>
      </span>
      <input type="checkbox" className="h-6 w-6 accent-black" checked={large} onChange={(e) => setLarge(e.target.checked)} />
    </label>
  );
}

/**
 * Privacy (SPEC §30.2): the lamp-glow ring and "active 2 h ago" in Kutumb,
 * and the status on the window. Stored as care_settings.shareVisits; the
 * other care settings are kept as they are.
 */
function LampToggle({ onMessage }: { onMessage: (m: string) => void }) {
  const { viewer } = useViewer();
  const { data, reload } = useJson<{ settings: { memberId: string; quietAlert: boolean; tellMemberId: string | null; graceHours: number; shareVisits: boolean }[] }>("/api/presence");
  const mine = data?.settings.find((s) => s.memberId === viewer.id);
  const on = mine?.shareVisits ?? true;
  const [busy, setBusy] = useState(false);
  const set = async (next: boolean) => {
    setBusy(true);
    const res = await fetch("/api/presence", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quietAlert: mine?.quietAlert ?? false, tellMemberId: mine?.tellMemberId ?? null, graceHours: mine?.graceHours ?? 3, shareVisits: next }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      await reload();
      onMessage(next ? "Your lamp shows to family again." : "Your lamp and activity are private now.");
    } else onMessage("Couldn't save that. Try again.");
  };
  return (
    <label className="mt-4 flex items-center justify-between gap-3 rounded-[22px] bg-surface px-4 py-4">
      <span>
        <span className="block text-[16px] font-medium">Show my lamp and activity to family</span>
        <span className="block text-[13px] text-ink-soft">When it&rsquo;s off, nobody sees when you were last in Aangan.</span>
      </span>
      <input type="checkbox" className="h-6 w-6 shrink-0 accent-black" checked={on} disabled={data === null || busy} onChange={(e) => void set(e.target.checked)} />
    </label>
  );
}

/** Searchable picker: dozens of languages would be a wall of radio buttons. */
function LanguagePicker({ value, onPick }: { value: SupportedLang; onPick: (code: SupportedLang) => void }) {
  const t = useT();
  useDocumentLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = language(value);
  const query = q.trim().toLowerCase();
  const list = LANGUAGES.filter((l) => !query || l.name.toLowerCase().includes(query) || l.native.toLowerCase().includes(query) || l.code.includes(query));
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="press flex w-full items-center justify-between rounded-[20px] bg-surface px-4 py-3.5 text-start"
      >
        <span>
          <span className="block text-[17px] font-semibold">{current.native}</span>
          <span className="block text-[14px] text-ink-soft">{current.name}</span>
        </span>
        <span className="text-[15px] font-medium text-ink-soft">{open ? t("settings.done") : t("settings.change")}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-[20px] bg-surface p-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("settings.search")}
            aria-label={t("settings.search")}
            className="h-11 w-full rounded-full bg-white px-4 text-[16px] outline-none focus:ring-2 focus:ring-marigold"
          />
          <ul role="radiogroup" aria-label={t("settings.language")} className="m-0 mt-2 max-h-[320px] list-none overflow-y-auto p-0">
            {list.map((l) => (
              <li key={l.code}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={l.code === value}
                  onClick={() => {
                    onPick(l.code);
                    setOpen(false);
                    setQ("");
                  }}
                  className={cn("press flex h-12 w-full items-center justify-between rounded-[14px] px-3 text-start", l.code === value && "bg-black text-white")}
                >
                  <span className="text-[16px] font-medium" dir={"rtl" in l && l.rtl ? "rtl" : undefined}>
                    {l.native}
                  </span>
                  <span className={cn("flex items-center gap-1.5 text-[13px]", l.code === value ? "text-white/70" : "text-ink-soft")}>
                    {hasUiCatalogue(l.code) && <Icon name="check" size={13} />}
                    {l.name}
                  </span>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-3 py-3 text-[15px] text-ink-soft">{t("settings.noMatch")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}


/** Settings → Language: one choice drives the app's words and the family's translations. */
function LanguageSection({ value, onPick, onMessage }: { value: SupportedLang; onPick: (code: SupportedLang) => void; onMessage: (m: string) => void }) {
  const t = useT();
  return (
    <Group title={t("settings.language")}>
      <LanguagePicker
        value={value}
        onPick={(code) => {
          onPick(code);
          void ensureCatalogue(code).then(() => onMessage(translate(code, "settings.languageUpdated")));
        }}
      />
      <p className="m-0 mt-2 text-[13px] text-ink-faint">{t("settings.languageNote")}</p>
      <p className="m-0 mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-faint">
        <Icon name="check" size={13} />
        {t("settings.appSpeaks")}
      </p>
    </Group>
  );
}

/** Mail and nudges: one letter a week, and as few small notes as you like. Only you can see or change these. */
function NudgeSettingsSection({ onMessage }: { onMessage: (m: string) => void }) {
  const { data, reload } = useJson<{ settings: { email: boolean; maxPerWeek: number }; hasEmail: boolean }>("/api/nudges/settings");
  const [busy, setBusy] = useState(false);
  const save = async (patch: Partial<{ email: boolean; maxPerWeek: number }>) => {
    if (!data) return;
    setBusy(true);
    const res = await fetch("/api/nudges/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...data.settings, ...patch }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      await reload();
      onMessage("Saved.");
    } else onMessage("Couldn't save that. Try again.");
  };
  const level = data?.settings.maxPerWeek ?? 3;
  const choices: [string, number][] = [["None", 0], ["Some", 2], ["All", 3]];
  const current = level === 0 ? 0 : level >= 3 ? 3 : 2;
  return (
    <>
      <label className="mt-4 flex items-center justify-between gap-3 rounded-[22px] bg-surface px-4 py-4">
        <span>
          <span className="block text-[16px] font-medium">Mail me a weekly letter</span>
          <span className="block text-[13px] text-ink-soft">{data && !data.hasEmail ? "Add an email to sign in first, then this can reach you." : "One morning email, at 8 where you are."}</span>
        </span>
        <input type="checkbox" className="h-6 w-6 shrink-0 accent-black" checked={data?.settings.email ?? false} disabled={data === null || busy} onChange={(e) => void save({ email: e.target.checked })} />
      </label>
      <div className="mt-3 rounded-[22px] bg-surface px-4 py-4">
        <span className="block text-[16px] font-medium">Nudges</span>
        <span className="block text-[13px] text-ink-soft">Small notes like &ldquo;Maa heard your voice note&rdquo;. Never more than three a week.</span>
        <div role="group" aria-label="Nudges" className="mt-3 grid grid-cols-4 gap-1 rounded-full bg-black/[.05] p-1">
          {choices.map(([label, n]) => (
            <button key={label} type="button" aria-pressed={current === n} disabled={data === null || busy} onClick={() => void save({ maxPerWeek: n })} className={cn("press h-11 rounded-full text-[15px] font-semibold", current === n ? "bg-white text-ink shadow-sm" : "text-ink-soft")}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Group({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} id={id} className="mt-9 scroll-mt-6">
      <h2 className="m-0 mb-3 text-[20px]">{title}</h2>
      {children}
    </section>
  );
}

const TABS = [
  ["you", "You"],
  ["window", "Window"],
  ["family", "People"],
  ["privacy", "Privacy"],
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const { viewer, displayLang, setDisplayLang, refreshMembers } = useViewer();
  const [name, setName] = useState(viewer.firstName);
  const [tz, setTz] = useState(viewer.tz);
  const [saved, setSaved] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const portraitRef = useRef<HTMLInputElement>(null);
  const homeRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"you" | "window" | "family" | "privacy">("you");
  useEffect(() => {
    const h = window.location.hash;
    if (h === "#invite" || h === "#roles") setTab("family");
    if (h === "#privacy") setTab("privacy");
    if (h === "#window" || h === "#connected-apps") setTab("window");
  }, []);

  useEffect(() => {
    setName(viewer.firstName);
    setTz(viewer.tz);
  }, [viewer.firstName, viewer.tz]);

  useEffect(() => {
    fetch("/api/invites", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { invites?: Invite[] } | null) => {
        const live = (d?.invites ?? []).filter((i) => new Date(i.expiresAt).getTime() > Date.now());
        setInvite(live[0] ?? null);
      })
      .catch(() => undefined);
  }, []);

  const flash = (msg: string) => {
    setSaved(msg);
    window.setTimeout(() => setSaved(null), 2200);
  };

  const saveProfile = async (patch: { firstName?: string; tz?: string; photoRef?: string; city?: string }) => {
    const res = await fetch("/api/members/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (res.ok) {
      await refreshMembers();
      flash("Saved");
    } else flash("Couldn't save. Try again.");
  };

  const uploadImage = async (file: File, kind: "portrait" | "home") => {
    setBusy(kind);
    try {
      const { mediaRef, palette } = await processHomeImage(file);
      if (kind === "portrait") await saveProfile({ photoRef: mediaRef });
      else {
        await fetch("/api/members/home-image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId: viewer.id, mediaRef, palette }) });
        await refreshMembers();
        flash("Home photo updated");
      }
    } catch {
      flash("That photo couldn't be read. Try another.");
    } finally {
      setBusy(null);
    }
  };

  const newInvite = async () => {
    setBusy("invite");
    try {
      const res = await fetch("/api/invites", { method: "POST" });
      if (res.ok) setInvite(((await res.json()) as { invite: Invite }).invite);
    } finally {
      setBusy(null);
    }
  };

  const shareInvite = async () => {
    if (!invite) return;
    const text = `Join our family on Aangan. Your code: ${invite.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Aangan", text, url: window.location.origin });
      else {
        await navigator.clipboard.writeText(`${text}\n${window.location.origin}`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  const removeMemories = async () => {
    setBusy("remove");
    const res = await fetch("/api/privacy/cards", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId: viewer.id }) });
    setBusy(null);
    flash(res.ok ? "Your wishes, reactions and listens were deleted" : "Couldn't delete. Try again.");
  };

  const leave = async () => {
    setBusy("leave");
    const res = await fetch("/api/privacy/membership", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId: viewer.id }) });
    if (res.ok) {
      await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
      resetFamilyCards();
      window.dispatchEvent(new Event("aangan:auth"));
      router.replace("/");
    } else {
      setBusy(null);
      setConfirmLeave(false);
      flash(res.status === 409 ? "You're the only admin. Make someone else admin first (People & roles)." : "Couldn't leave. Try again.");
    }
  };

  const signOut = async () => {
    await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    resetFamilyCards();
    window.dispatchEvent(new Event("aangan:auth"));
    router.replace("/");
  };

  const home = resolveMediaUrl(viewer.homeImageRef) ?? "/demo/courtyard.jpg";

  return (
    <div>
      <RoomHeader title="Settings" />

      <div className="flex items-center gap-4">
        <button type="button" onClick={() => portraitRef.current?.click()} className="press relative rounded-full" aria-label="Change your photo">
          <Avatar src={memberPhoto(viewer)} name={viewer.firstName} size={76} ring />
          <span className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full bg-black text-white">
            <Icon name="camera" size={14} />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <label className="block">
            <span className="sr-only">Your first name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name.trim() !== viewer.firstName && void saveProfile({ firstName: name.trim() })}
              className="w-full bg-transparent text-[24px] font-bold outline-none focus:underline"
              maxLength={40}
            />
          </label>
          <p className="m-0 text-[14px] text-ink-soft">The family calls you {viewer.displayName}</p>
        </div>
        <input ref={portraitRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadImage(e.target.files[0], "portrait")} />
      </div>

      <nav aria-label="Settings sections" className="mt-7 grid grid-cols-4 gap-1 rounded-full bg-surface p-1">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={cn("press h-10 rounded-full text-[15px] font-semibold", tab === id ? "bg-white text-ink shadow-sm" : "text-ink-soft")}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "window" && (
        <>
      <Group title="Your first screen" id="window">
        <WindowOptions />
        <WindowSettings />
      </Group>
      <Group title="Connected apps" id="connected-apps">
        <ConnectedApps />
      </Group>
        </>
      )}

      {tab === "you" && (
        <>
      <LanguageSection value={displayLang} onPick={(code) => void setDisplayLang(code)} onMessage={flash} />

      <Group title="Reading">
        <LargeTextToggle />
      </Group>

      <Group title="Mail and nudges">
        <NudgeSettingsSection onMessage={flash} />
      </Group>

      <Group title="Where you are">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">Time zone, so family sees your local time</span>
          <select
            value={tz}
            onChange={(e) => {
              setTz(e.target.value);
              void saveProfile({ tz: e.target.value });
            }}
            className="h-[52px] w-full appearance-none rounded-full bg-surface px-5 text-[16px] outline-none focus:ring-2 focus:ring-marigold"
          >
            {Array.from(new Set([viewer.tz, ...ZONES.map((z) => z.tz)])).map((z) => (
              <option key={z} value={z}>
                {placeFromTz(z)}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">Your city, so the other home sees your sky and weather</span>
          <input
            defaultValue={viewer.city}
            placeholder="Bengaluru"
            maxLength={60}
            onBlur={(e) => e.target.value.trim() !== viewer.city && void saveProfile({ city: e.target.value.trim() })}
            className="h-[52px] w-full rounded-full bg-surface px-5 text-[16px] outline-none focus:ring-2 focus:ring-marigold"
          />
        </label>
        <div className="relative mt-4 h-[160px] overflow-hidden rounded-card bg-surface">
          <Photo src={home} alt="Your home photo" sizes="440px" />
          <div className="glass absolute inset-x-2.5 bottom-2.5 flex items-center justify-between rounded-[18px] py-2.5 pl-4 pr-2.5">
            <span className="text-[15px] font-semibold">The home you miss</span>
            <button type="button" onClick={() => homeRef.current?.click()} className="press h-9 rounded-full bg-white px-4 text-[14px] font-semibold text-black">
              {busy === "home" ? "Uploading…" : "Change"}
            </button>
          </div>
          <input ref={homeRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadImage(e.target.files[0], "home")} />
        </div>
      </Group>

        </>
      )}

      {tab === "family" && (
        <>
      <WaitingToJoin onMessage={flash} />
      <Group title="Invite family" id="invite">
        {!can(viewer, "invite.create") ? (
          <p className="m-0 text-[15px] text-ink-soft">Ask a grown-up in the family to invite people.</p>
        ) : invite ? (
          <div className="rounded-[22px] bg-surface p-4">
            <p className="m-0 text-[13px] text-ink-soft">Share this code. It works until {new Date(invite.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.</p>
            <p className="tnum m-0 mt-1 text-[28px] font-bold tracking-[0.12em]">{invite.code}</p>
            <Button className="mt-3 w-full" onClick={() => void shareInvite()}>
              {copied ? "Copied" : "Share invite"}
            </Button>
            {can(viewer, "invite.revoke") && (
              <button
                type="button"
                className="mt-2 h-10 w-full text-[14px] font-medium text-[#b42318]"
                onClick={async () => {
                  const res = await fetch("/api/invites", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: invite.code }) });
                  if (res.ok) {
                    setInvite(null);
                    flash("Code revoked. It no longer works.");
                  }
                }}
              >
                Revoke this code
              </button>
            )}
          </div>
        ) : (
          <Button className="w-full" disabled={busy === "invite"} onClick={() => void newInvite()}>
            {busy === "invite" ? "Creating…" : "Create an invite code"}
          </Button>
        )}
      </Group>

      <Group title="People & roles" id="roles">
        <PeopleAndRoles onMessage={flash} />
      </Group>

        </>
      )}

      {tab === "privacy" && (
        <>
      <Group title="Privacy" id="privacy">
        <ul className="m-0 list-none space-y-2 p-0 text-[15px] text-ink-soft">
          <li>Only your family sees what you share. Photos lose their location before upload.</li>
          <li>Voices are never cloned. No face recognition, and no tagging of children.</li>
          <li>Demo mode: Meta&rsquo;s AI models process content to caption, transcribe and translate.</li>
        </ul>
        <LampToggle onMessage={flash} />
        {isGrownUp(viewer) && (
          <div className="mt-4 overflow-hidden rounded-[22px] bg-surface">
            <a href="/api/export" download className="press flex w-full items-center justify-between px-4 py-4 text-left text-[16px] font-medium text-ink no-underline">
              <span>
                <span className="block">Download our family&rsquo;s data</span>
                <span className="block text-[13px] font-normal text-ink-soft">Everyone, the tree, recipes, care and memories, as one file you own</span>
              </span>
              <Icon name="down" size={18} className="text-ink-faint" />
            </a>
            <div className="mx-4 h-px bg-[var(--line)]" />
            <SharedLinks onMessage={flash} />
          </div>
        )}
        <div className="mt-4 overflow-hidden rounded-[22px] bg-surface">
          <button type="button" onClick={() => void removeMemories()} disabled={busy === "remove"} className="press flex w-full items-center justify-between px-4 py-4 text-left text-[16px] font-medium">
            Delete my reactions, wishes and listens
            <Icon name="chevron" size={18} className="text-ink-faint" />
          </button>
          <div className="mx-4 h-px bg-[var(--line)]" />
          {confirmLeave ? (
            <div className="px-4 py-4">
              <p className="m-0 text-[15px]">Leave the family? Your profile and place in the tree are deleted. Shared memories stay with the family.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setConfirmLeave(false)} className="press h-10 flex-1 rounded-full bg-white text-[14px] font-semibold">
                  Stay
                </button>
                <button type="button" onClick={() => void leave()} disabled={busy === "leave"} className="press h-10 flex-1 rounded-full bg-[#b42318] text-[14px] font-semibold text-white">
                  {busy === "leave" ? "Leaving…" : "Leave family"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmLeave(true)} className="press flex w-full items-center justify-between px-4 py-4 text-left text-[16px] font-medium text-[#b42318]">
              Leave the family
              <Icon name="chevron" size={18} className="text-ink-faint" />
            </button>
          )}
        </div>
      </Group>

      {process.env.NODE_ENV !== "production" && (
      <Group title="Muse">
        <Link href="/trace" className="press flex items-center justify-between rounded-[22px] bg-surface px-4 py-4 text-[16px] font-medium text-ink no-underline">
          <span>
            <span className="block">What Muse did for your family</span>
            <span className="block text-[13px] font-normal text-ink-soft">Every caption, translation and suggestion, step by step</span>
          </span>
          <Icon name="chevron" size={18} className="text-ink-faint" />
        </Link>
      </Group>
      )}
        </>
      )}

      <Button variant="secondary" className="mt-9 w-full" onClick={() => void signOut()}>
        Sign out
      </Button>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-50 flex justify-center" style={{ bottom: "calc(24px + env(safe-area-inset-bottom))" }}>
        {saved && <p className="frost glass-pill m-0 px-5 py-3 text-[15px] font-medium">{saved}</p>}
      </div>
    </div>
  );
}

/** What this family has shared outside itself, and a way to take it back. */
function SharedLinks({ onMessage }: { onMessage: (m: string) => void }) {
  const { data, reload } = useJson<{ shares: { token: string; title: string; views: number }[] }>("/api/share");
  const list = data?.shares ?? [];
  return (
    <div className="px-4 py-4">
      <p className="m-0 text-[16px] font-medium">Shared outside the family</p>
      {list.length === 0 ? (
        <p className="m-0 mt-1 text-[13px] text-ink-soft">Nothing yet. Recipes you share appear here.</p>
      ) : (
        <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
          {list.map((s) => (
            <li key={s.token} className="flex items-center justify-between gap-3 text-[14px]">
              <span className="min-w-0 truncate">
                {s.title} <span className="text-ink-faint">· opened {s.views}×</span>
              </span>
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/share", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: s.token }) });
                  await reload();
                  onMessage("Stopped sharing. The link no longer works.");
                }}
                className="h-9 shrink-0 text-[14px] font-semibold text-[#a32418]"
              >
                Stop
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
