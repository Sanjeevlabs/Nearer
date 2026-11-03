"use client";

import { LoadFailed } from "@/components/load-failed";
import { useState } from "react";
import { can } from "@/lib/permissions";
import { ActionMenu, Avatar, Button, EmptyLine, Icon, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { householdName, households, type Household } from "@/lib/households";
import { HELPER_ROLES, type Helper } from "@/lib/kinds";
import { emergencyNumber, isDialable, MAX_NEARBY, rankNearby, telHref, waHref } from "@/lib/nearby";
import { callName, memberPhoto } from "@/lib/people";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { placeFromTz } from "@/lib/zones";
import { Boundary } from "@/components/ui/boundary";

// Trusted nearby (SPEC §29.9): for every home, your top 5 people nearby, in
// the order to call them. If the family can't reach someone, they call #1,
// then #2, and so on. Calls open the phone's own dialer (an ordinary call on
// the local mobile network). Not an emergency service: the local emergency
// number is always one tap away.

const ESCALATION = "If they don't pick up, call #1, then #2, and so on down the list.";
const ERRORS: Record<string, string> = {
  "needs-consent": "Tick that they've agreed to be listed.",
  "invalid-phone": "Enter a full phone number, like +91 98765 43210.",
  "nearby-full": `This home already has ${MAX_NEARBY}. Remove someone first.`,
};

export default function NearbyPage() {
  const { viewer, members, relationships } = useViewer();
  const { data, failed, reload } = useJson<{ helpers: Helper[] }>("/api/care");
  const homes = households(members, relationships)
    .filter((h) => h.members.some((m) => m.role !== "child"))
    // Your home first, then the parents', then everyone else.
    .sort((a, b) => Number(b.members.some((m) => m.id === viewer.id)) - Number(a.members.some((m) => m.id === viewer.id)) || Number(b.elders) - Number(a.elders));
  return (
    <div>
      <RoomHeader title="Trusted nearby" subtitle={`For every home, your top ${MAX_NEARBY} people close by, in the order to call them.`} />
      {failed && !data ? (
        <LoadFailed what="The list" ui="nearby-retry" onRetry={() => void reload()} />
      ) : !data ? (
        <div className="skeleton h-[300px] rounded-card" aria-busy="true" aria-label="Loading" />
      ) : (
        homes.map((h) => <Boundary key={h.id} label="This home"><HomeNearby home={h} helpers={rankNearby((data.helpers ?? []).filter((x) => x.emergency && h.members.some((m) => m.id === x.forMemberId)))} onChange={reload} /></Boundary>)
      )}
    </div>
  );
}

function HomeNearby({ home, helpers, onChange }: { home: Household; helpers: Helper[]; onChange: () => Promise<void> }) {
  const { viewer } = useViewer();
  const mine = home.members.some((m) => m.id === viewer.id);
  const mayEdit = can(viewer, "care.write");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const city = home.members.find((m) => m.city)?.city || placeFromTz(home.tz);
  const sos = emergencyNumber(home.tz);
  const full = helpers.length >= MAX_NEARBY;
  const move = async (id: string, dir: -1 | 1) => {
    setBusy(true);
    await postJson("/api/care", { action: "nearby-move", helperId: id, dir });
    await onChange();
    setBusy(false);
  };
  return (
    <section aria-label={mine ? "Around you" : `Around ${householdName(home, callName)}`} className="mb-7">
      <div className="mb-2 flex items-center gap-3">
        <span className="flex -space-x-2">
          {home.members.filter((m) => m.role !== "child").slice(0, 3).map((m) => (
            <span key={m.id} className="rounded-full ring-2 ring-white">
              <Avatar src={memberPhoto(m)} name={callName(m)} size={34} />
            </span>
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-headline">{mine ? "Around you" : `Around ${householdName(home, callName)}`}</h2>
          <p className="m-0 text-footnote text-ink-soft">
            {city} · <span className="tnum">{helpers.length}/{MAX_NEARBY}</span>
          </p>
        </div>
        <a href={`tel:${sos}`} className="press flex h-10 items-center gap-1.5 rounded-full bg-accent px-3.5 text-callout font-semibold text-accent-ink no-underline" aria-label={`Emergency services in ${city}: ${sos}`}>
          <span className="h-2 w-2 rounded-full bg-[#d92d20]" aria-hidden="true" />
          {sos}
        </a>
      </div>
      <p className="m-0 mb-2 text-footnote text-ink-soft">{ESCALATION}</p>

      {helpers.length === 0 && !adding ? (
        <EmptyLine>{mine ? "Add the first person near you your family can call." : "No one yet. Ask them who lives close and would come."}</EmptyLine>
      ) : helpers.length > 0 ? (
        <ol className="m-0 list-none divide-y divide-[var(--line)] overflow-hidden rounded-[22px] bg-surface p-0">
          {helpers.map((h, i) => (
            <li key={h.id}>
              <div className="flex items-center gap-2 py-2.5 pl-3 pr-1.5">
                <span className={cn("tnum grid h-8 w-8 shrink-0 place-items-center rounded-full text-callout font-bold", i === 0 ? "bg-accent text-accent-ink" : "bg-surface text-ink")} aria-label={`Number ${i + 1}`}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold leading-tight">{h.name}</span>
                  <span className="block truncate text-caption text-ink-soft first-letter:uppercase">{[h.role, h.note].filter(Boolean).join(" · ")}</span>
                </span>
                {h.phone && (
                  <>
                    <a href={waHref(h.phone)} target="_blank" rel="noreferrer" className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink" aria-label={`WhatsApp ${h.name}`}>
                      <Icon name="whatsapp" size={17} />
                    </a>
                    <a href={telHref(h.phone)} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink" aria-label={`Call ${h.name}, number ${i + 1}`}>
                      <Icon name="phone" size={18} />
                    </a>
                  </>
                )}
                {mayEdit && (
                  <ActionMenu
                    label={`${h.name} options`}
                    actions={[
                      ...(i > 0 ? [{ label: "Move up", onSelect: () => move(h.id, -1) }] : []),
                      ...(i < helpers.length - 1 ? [{ label: "Move down", onSelect: () => move(h.id, 1) }] : []),
                      { label: "Edit", onSelect: () => setEditing(h.id) },
                      {
                        label: "Remove",
                        danger: true,
                        confirm: `Take ${h.name} off the list?`,
                        onSelect: async () => {
                          await postJson("/api/care", { action: "helper-remove", helperId: h.id });
                          await onChange();
                        },
                      },
                    ]}
                  />
                )}
              </div>
              {editing === h.id && (
                <div className="px-3 pb-3">
                  <NearbyForm helper={h} forMemberId={h.forMemberId} onDone={async () => { setEditing(null); await onChange(); }} />
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      {busy && <span className="sr-only" role="status">Reordering…</span>}

      {mayEdit &&
        (adding ? (
          <div className="mt-2">
            <NearbyForm forMemberId={mine ? viewer.id : home.members[0].id} onDone={async () => { setAdding(false); await onChange(); }} />
          </div>
        ) : full ? (
          <p className="m-0 mt-2 px-1 text-footnote text-ink-faint">That&rsquo;s your top {MAX_NEARBY}. To add someone, take someone off first.</p>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="press mt-2 flex h-11 items-center gap-2 px-1 text-body font-semibold">
            <Icon name="plus" size={17} /> Add #{helpers.length + 1}
          </button>
        ))}
    </section>
  );
}

function NearbyForm({ helper, forMemberId, onDone }: { helper?: Helper; forMemberId: string; onDone: () => void | Promise<void> }) {
  const [name, setName] = useState(helper?.name ?? "");
  const [role, setRole] = useState<Helper["role"]>(helper?.role ?? "friend");
  const [phone, setPhone] = useState(helper?.phone ?? "");
  const [note, setNote] = useState(helper?.note ?? "");
  const [consent, setConsent] = useState(helper?.consent ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const phoneOk = isDialable(phone);
  const input = "h-12 w-full rounded-[14px] bg-surface px-4 text-body outline-none ring-1 ring-[var(--line)] focus:ring-2 focus:ring-black/30";
  const save = async () => {
    setBusy(true);
    const fields = { name: name.trim(), role, phone: phone.trim(), note: note.trim(), emergency: true, consent };
    const res = await fetch("/api/care", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(helper ? { action: "helper-edit", helperId: helper.id, ...fields } : { action: "helper", forMemberId, ...fields }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "";
      return setError(ERRORS[code] ?? "Couldn't save. Try again.");
    }
    await onDone();
  };
  return (
    <div className="space-y-2 rounded-[22px] bg-surface p-3">
      <input className={input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} aria-label="Name" />
      <div className="flex gap-2">
        <select className={input} value={role} onChange={(e) => setRole(e.target.value as Helper["role"])} aria-label="Relation">
          {HELPER_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          className={cn(input, phone && !phoneOk && "ring-2 ring-[#d92d20]/60")}
          placeholder="+91 98765 43210"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/[^+\d\s()-]/g, "").slice(0, 30))}
          aria-label="Phone number, with country code"
          aria-invalid={Boolean(phone) && !phoneOk}
        />
      </div>
      <input className={input} placeholder="Where, and anything useful (has a spare key…)" value={note} onChange={(e) => setNote(e.target.value.slice(0, 160))} aria-label="Note" />
      <label className="flex items-start gap-2.5 px-1 py-1 text-callout text-ink-soft">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-black" />
        They know they&rsquo;re on this list and are happy for the family to call them.
      </label>
      {error && <p className="m-0 px-1 text-footnote text-[#a3271b]" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button className="h-11 flex-1 text-body" disabled={busy || !name.trim() || !consent || !phoneOk} onClick={() => void save()}>
          {helper ? "Save" : "Add"}
        </Button>
        <Button variant="secondary" className="h-11 flex-1 !bg-surface text-body" onClick={() => void onDone()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
