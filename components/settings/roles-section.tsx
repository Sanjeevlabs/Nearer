"use client";

import { useState } from "react";
import { Avatar, Icon } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { ACCESS_LABEL, ACCESS_ORDER, can } from "@/lib/permissions";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { liveFetch, ROLE_ERROR, saveRoles, type RoleDraft } from "@/lib/settings-save";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./section";
import { useDraft } from "./use-draft";

/**
 * Who's who, and (for owners/admins) who may do what: one chip per role.
 * Choosing a role only changes the draft; Save writes them. Handing the family
 * over and removing someone are actions: they confirm, then happen at once.
 */
export function PeopleAndRoles({ onMessage }: { onMessage: (m: string) => void }) {
  const { viewer, members, refreshMembers } = useViewer();
  const admin = can(viewer, "roles.assign");
  const owner = can(viewer, "owner.transfer");
  const form = useDraft<RoleDraft>({}, { id: "roles" });
  const [busy, setBusy] = useState<string | null>(null);
  const rank = (a: Member["access"]) => ACCESS_ORDER.indexOf(a);
  const people = [...members].sort((a, b) => rank(a.access) - rank(b.access) || callName(a).localeCompare(callName(b)));
  const act = async (m: Member, url: string, init: RequestInit, ok: string) => {
    setBusy(m.id);
    const res = await liveFetch(url, { headers: { "content-type": "application/json" }, ...init }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(null);
    onMessage(res?.ok ? ok : (ROLE_ERROR[body?.error ?? ""] ?? "Couldn't change that. Try again."));
    await refreshMembers();
  };
  const current = (m: Member) => form.draft[m.id] ?? m.access;
  const pick = (m: Member, to: Member["access"]) => {
    if (to === "owner") {
      if (!window.confirm(`Hand the family over to ${callName(m)}? You'll stay an admin.`)) return;
      return void act(m, `/api/members/${encodeURIComponent(m.id)}/owner`, { method: "POST", body: "{}" }, `${callName(m)} owns the family now.`);
    }
    form.set((d) => {
      const next = { ...d };
      if (to === m.access) delete next[m.id];
      else next[m.id] = to;
      return next;
    });
  };
  const remove = (m: Member) => {
    if (!window.confirm(`Remove ${callName(m)} from the family? What they shared stays.`)) return;
    void act(m, `/api/members/${encodeURIComponent(m.id)}`, { method: "DELETE" }, `${callName(m)} was removed.`);
  };
  /** Chips this viewer may tap for this person. */
  const choices = (m: Member): Member["access"][] => {
    if (!admin || m.access === "owner") return [];
    return ACCESS_ORDER.filter((a) => (a === "owner" ? owner && (m.access === "admin" || m.access === "member") : a === "child" ? !m.email : true));
  };
  const list = (
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
                  <span className="block truncate text-body font-semibold">
                    {callName(m)}
                    {m.id === viewer.id ? " (you)" : ""}
                  </span>
                  <span className="block text-footnote text-ink-soft">{m.email ? "Has their own account" : "Added by family"}</span>
                </span>
                {options.length === 0 && <span className="rounded-full bg-white px-3 py-1.5 text-footnote font-semibold">{ACCESS_LABEL[m.access].label}</span>}
                {removable && (
                  <button type="button" aria-label={`Remove ${callName(m)}`} disabled={busy === m.id} onClick={() => remove(m)} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-soft disabled:opacity-40">
                    <Icon name="trash" size={18} />
                  </button>
                )}
              </div>
              {options.length > 0 && (
                <div role="radiogroup" aria-label={`${callName(m)}'s role`} className="no-scrollbar -mx-1 mt-1.5 flex gap-1.5 overflow-x-auto px-1">
                  {options.map((a) => {
                    const on = a === current(m);
                    return (
                      <button
                        key={a}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={busy === m.id}
                        onClick={() => pick(m, a)}
                        className={cn("press h-11 shrink-0 rounded-full px-4 text-footnote font-semibold disabled:opacity-40", on ? "bg-ink text-white" : "bg-white text-ink")}
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
      <ul className="m-0 mt-3 list-none space-y-1 p-0 text-footnote text-ink-soft">
        {ACCESS_ORDER.map((a) => (
          <li key={a}>
            <span className="font-semibold text-ink">{ACCESS_LABEL[a].label}</span> · {ACCESS_LABEL[a].note}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <SettingsSection
      id="roles"
      title="People & roles"
      tab="family"
      form={form}
      hideSave={!admin}
      onSave={async (d) => {
        const r = await saveRoles(liveFetch, d);
        await refreshMembers();
        if (r.ok) onMessage("Saved");
        return r;
      }}
    >
      {list}
    </SettingsSection>
  );
}
