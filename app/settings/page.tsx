"use client";

import Link from "next/link";
import { useJson } from "@/lib/use-json";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, Button, Icon, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { memberPhoto } from "@/lib/people";
import { resetFamilyCards } from "@/lib/use-family";
import { can, isAdmin, isGrownUp } from "@/lib/permissions";
import type { Member } from "@/lib/schemas";
import { callName } from "@/lib/people";
import { cn } from "@/lib/utils";
import { WindowOptions } from "./window-options";
import { ConnectedApps } from "@/components/connected-apps";
import { Group, UnsavedBanner } from "@/components/settings/section";
import { LampSection, LanguageSection, NudgeSettingsSection, ProfileSection, ReadingSection, WhereSection } from "@/components/settings/account-sections";
import { PeopleAndRoles } from "@/components/settings/roles-section";
import { NotificationsSection } from "@/components/settings/push-section";
import { HowWereDoing, ProblemsSeen, TellUsByVoice } from "@/components/settings/team-sections";
import { forgetPushDevice } from "@/lib/web-push";
import { getPendingTabs } from "@/lib/settings-pending";

interface Invite {
  code: string;
  expiresAt: string;
}

import { ROLE_ERROR } from "@/lib/settings-save";

/** Joiners waiting for an owner/admin, at the top of the Family tab. */
function WaitingToJoin({ onMessage }: { onMessage: (m: string) => void }) {
  const { viewer, refreshMembers } = useViewer();
  const allowed = can(viewer, "members.approve");
  const { data, failed, reload } = useJson<{ pending: Member[] }>(allowed ? "/api/members" : null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!allowed) return null;
  if (failed) return <p className="m-0 mt-6 rounded-[22px] bg-surface p-4 text-callout text-ink-soft">Couldn&rsquo;t check who&rsquo;s waiting. Pull to try again.</p>;
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
      <h2 className="m-0 mb-3 text-title">Waiting to join</h2>
      <ul className="m-0 list-none divide-y divide-[var(--line)] rounded-[22px] bg-surface p-0 px-4">
        {data.pending.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-3">
            <Avatar src={memberPhoto(m)} name={callName(m)} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold">{callName(m)}</span>
              <span className="block text-footnote text-ink-soft">{m.city ? `Joined with a code · ${m.city}` : "Joined with a code"}</span>
            </span>
            <button type="button" aria-label={`Decline ${callName(m)}`} disabled={busy === m.id} onClick={() => void decide(m, "decline")} className="press grid h-11 w-11 place-items-center rounded-full bg-surface text-ink disabled:opacity-40">
              <Icon name="close" size={20} />
            </button>
            <button type="button" aria-label={`Let ${callName(m)} in`} disabled={busy === m.id} onClick={() => void decide(m, "approve")} className="press grid h-11 w-11 place-items-center rounded-full bg-accent text-accent-ink disabled:opacity-40">
              <Icon name="check" size={20} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type TabId = "you" | "window" | "family" | "privacy";
const TABS = [
  ["you", "You"],
  ["window", "Window"],
  ["family", "People"],
  ["privacy", "Privacy"],
] as const satisfies readonly (readonly [TabId, string])[];

export default function SettingsPage() {
  const router = useRouter();
  const { viewer } = useViewer();
  const [saved, setSaved] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("you");
  // A panel mounts the first time it is opened and then stays (hidden), so
  // unsaved edits survive switching tabs. Tabs with a draft left from an
  // earlier visit to this page open too.
  const [opened, setOpened] = useState<Set<TabId>>(() => new Set<TabId>(["you", ...(getPendingTabs() as TabId[])]));
  const go = (t: TabId) => {
    setTab(t);
    setOpened((o) => (o.has(t) ? o : new Set(o).add(t)));
  };
  useEffect(() => {
    const h = window.location.hash;
    if (h === "#invite" || h === "#roles") go("family");
    if (h === "#privacy") go("privacy");
    if (h === "#window" || h === "#connected-apps") go("window");
  }, []);

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
    const text = `Join our family on Nearer. Your code: ${invite.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Nearer", text, url: window.location.origin });
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
      // The server already dropped this person's devices; this ends the browser's side of it.
      await forgetPushDevice().catch(() => undefined);
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
    // This phone stops getting this person's notes (needs the session, so before it is cleared).
    await forgetPushDevice().catch(() => undefined);
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

  return (
    <div>
      <RoomHeader title="Settings" />

      <nav data-ui="settings-tabs" aria-label="Settings sections" className="mt-7 grid grid-cols-4 gap-1 rounded-full bg-surface p-1">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => go(id)} className={cn("press h-11 rounded-full text-body font-semibold", tab === id ? "bg-surface text-ink shadow-sm" : "text-ink-soft")}>
            {label}
          </button>
        ))}
      </nav>
      <UnsavedBanner tab={tab} />

      {opened.has("window") && (
        <div hidden={tab !== "window"}>
          <WindowOptions onMessage={flash} />
          <Group title="Connected apps" id="connected-apps">
            <ConnectedApps />
          </Group>
        </div>
      )}

      <div hidden={tab !== "you"}>
        <ProfileSection onMessage={flash} />
        <LanguageSection onMessage={flash} />
        <ReadingSection onMessage={flash} />
        <NudgeSettingsSection onMessage={flash} />
        <NotificationsSection onMessage={flash} />
        <WhereSection onMessage={flash} />
      </div>

      {opened.has("family") && (
        <div hidden={tab !== "family"}>
      <WaitingToJoin onMessage={flash} />
      <Group title="Invite family" id="invite">
        {!can(viewer, "invite.create") ? (
          <p className="m-0 text-body text-ink-soft">Ask a grown-up in the family to invite people.</p>
        ) : invite ? (
          <div className="rounded-[22px] bg-surface p-4">
            <p className="m-0 text-footnote text-ink-soft">Share this code. It works until {new Date(invite.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.</p>
            <p data-display className="tnum m-0 mt-1 text-display font-bold tracking-[0.12em]">{invite.code}</p>
            <Button className="mt-3 w-full" onClick={() => void shareInvite()}>
              {copied ? "Copied" : "Share invite"}
            </Button>
            {can(viewer, "invite.revoke") && (
              <button
                type="button"
                className="mt-2 h-11 w-full text-callout font-medium text-[#b42318]"
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

      <PeopleAndRoles onMessage={flash} />
        </div>
      )}

      {opened.has("privacy") && (
        <div hidden={tab !== "privacy"}>
      <Group title="Privacy" id="privacy">
        <ul className="m-0 list-none space-y-2 p-0 text-body text-ink-soft">
          <li>Only your family sees what you share. Photos lose their location before upload.</li>
          <li>Voices are never cloned. No face recognition, and no tagging of children.</li>
          <li>Demo mode: Meta&rsquo;s AI models process content to caption, transcribe and translate.</li>
        </ul>
        <LampSection onMessage={flash} />
        {isGrownUp(viewer) && (
          <div className="mt-4 overflow-hidden rounded-[22px] bg-surface">
            <a href="/api/export" download className="press flex w-full items-center justify-between px-4 py-4 text-left text-body font-medium text-ink no-underline">
              <span>
                <span className="block">Download our family&rsquo;s data</span>
                <span className="block text-footnote font-normal text-ink-soft">Everyone, the tree, recipes, care and memories, as one file you own</span>
              </span>
              <Icon name="down" size={18} className="text-ink-faint" />
            </a>
            <div className="mx-4 h-px bg-[var(--line)]" />
            <SharedLinks onMessage={flash} />
          </div>
        )}
        <div className="mt-4 overflow-hidden rounded-[22px] bg-surface">
          <button type="button" onClick={() => { if (window.confirm("Delete your reactions, wishes and listens? This can't be undone.")) void removeMemories(); }} disabled={busy === "remove"} className="press flex w-full items-center justify-between px-4 py-4 text-left text-body font-medium">
            Delete my reactions, wishes and listens
            <Icon name="chevron" size={18} className="text-ink-faint" />
          </button>
          <div className="mx-4 h-px bg-[var(--line)]" />
          {confirmLeave ? (
            <div className="px-4 py-4">
              <p className="m-0 text-body">Leave the family? Your profile and place in the tree are deleted. Shared memories stay with the family.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setConfirmLeave(false)} className="press h-11 flex-1 rounded-full bg-surface text-callout font-semibold">
                  Stay
                </button>
                <button type="button" onClick={() => void leave()} disabled={busy === "leave"} className="press h-11 flex-1 rounded-full bg-[#b42318] text-callout font-semibold text-white">
                  {busy === "leave" ? "Leaving…" : "Leave family"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmLeave(true)} className="press flex w-full items-center justify-between px-4 py-4 text-left text-body font-medium text-[#b42318]">
              Leave the family
              <Icon name="chevron" size={18} className="text-ink-faint" />
            </button>
          )}
        </div>
      </Group>

      {isAdmin(viewer) && <HowWereDoing />}
      {isAdmin(viewer) && <ProblemsSeen />}
      <TellUsByVoice onMessage={flash} />

      {process.env.NODE_ENV !== "production" && (
      <Group title="Muse">
        <Link href="/trace" className="press flex items-center justify-between rounded-[22px] bg-surface px-4 py-4 text-body font-medium text-ink no-underline">
          <span>
            <span className="block">What Muse did for your family</span>
            <span className="block text-footnote font-normal text-ink-soft">Every caption, translation and suggestion, step by step</span>
          </span>
          <Icon name="chevron" size={18} className="text-ink-faint" />
        </Link>
      </Group>
      )}
        </div>
      )}

      <Button variant="secondary" className="mt-9 w-full" onClick={() => void signOut()}>
        Sign out
      </Button>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-50 flex justify-center" style={{ bottom: "calc(24px + env(safe-area-inset-bottom))" }}>
        {saved && <p className="frost glass-pill m-0 px-4 py-3 text-body font-medium">{saved}</p>}
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
      <p className="m-0 text-body font-medium">Shared outside the family</p>
      {list.length === 0 ? (
        <p className="m-0 mt-1 text-footnote text-ink-soft">Nothing yet. Recipes you share appear here.</p>
      ) : (
        <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
          {list.map((s) => (
            <li key={s.token} className="flex items-center justify-between gap-3 text-callout">
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
                className="h-11 shrink-0 px-2 text-callout font-semibold text-[#a32418]"
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
