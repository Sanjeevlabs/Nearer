"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Member } from "@/lib/schemas";
import { ageOf, callName, memberPhoto } from "@/lib/people";
import { birthYearOf, birthdayProblem, buildBirthday, dayMonthLabel, mmdd } from "@/lib/birthday";
import { BirthYearField } from "./birth-year";
import { cn } from "@/lib/utils";
import { ZONES, placeFromTz } from "@/lib/zones";
import { can } from "@/lib/permissions";
import type { Relationship } from "@/lib/schemas";
import { Avatar, Button, Icon } from "./ui/kit";
import { useViewer } from "./viewer";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ROLES: { value: Member["role"]; label: string }[] = [
  { value: "elder", label: "Grandparent generation" },
  { value: "adult", label: "Parent generation" },
  { value: "child", label: "Child" },
];
const field = "h-[52px] w-full appearance-none rounded-full bg-surface px-5 text-[16px] outline-none focus:ring-2 focus:ring-marigold";

/** "Delhi · Age 9 · Birthday 9 Nov": the age only when the birth year is known. */
function aboutLine(person: Member): string {
  const age = ageOf(person);
  const day = dayMonthLabel(person.birthday);
  return [placeFromTz(person.tz), age !== null ? `Age ${age}` : null, day ? `Birthday ${day}` : "Birthday not added"].filter(Boolean).join(" · ");
}

/**
 * About this person: edit their details or remove them from the tree.
 * Rules mirror the server: a person with their own account manages themselves.
 */
export function PersonDetails({ person, onChanged }: { person: Member; onChanged: () => void }) {
  const router = useRouter();
  const { viewer, members, relationships, refreshMembers } = useViewer();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(person.displayName);
  const [role, setRole] = useState(person.role);
  const [tz, setTz] = useState(person.tz);
  const [month, setMonth] = useState(mmdd(person.birthday).slice(0, 2));
  const [day, setDay] = useState(mmdd(person.birthday).slice(3, 5));
  const [year, setYear] = useState(String(birthYearOf(person.birthday) ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSelf = person.id === viewer.id;
  const hasAccount = Boolean(person.email);
  const manageable = (!hasAccount && can(viewer, "tree.edit")) || isSelf;
  const removable = !isSelf && can(viewer, hasAccount ? "tree.remove-account" : "tree.remove");

  if (isSelf) return null; // You edit yourself in Settings.

  const save = async () => {
    const problem = birthdayProblem(month, day, year);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/members/${encodeURIComponent(person.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name.trim(), role, tz, birthday: buildBirthday(month, day, year) }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("Couldn't save. Try again.");
    await refreshMembers();
    setEditing(false);
    onChanged();
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/members/${encodeURIComponent(person.id)}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("Couldn't remove them. Try again.");
    await refreshMembers();
    router.replace("/bond");
  };

  return (
    <section aria-label={`About ${callName(person)}`} className="mt-10 rounded-card bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[20px]">About {callName(person)}</h2>
          <p className="m-0 mt-1 text-[14px] text-ink-soft">{aboutLine(person)}</p>
        </div>
        {manageable && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="press h-10 rounded-full bg-white px-4 text-[14px] font-semibold">
            Edit
          </button>
        )}
      </div>

      {!manageable && hasAccount && <p className="m-0 mt-3 text-[14px] text-ink-soft">{callName(person)} has their own account, so only they can change these details.</p>}

      {!editing && <Connections person={person} members={members} relationships={relationships} canEdit={can(viewer, "tree.edit")} canAdd={can(viewer, "tree.add")} onChanged={async () => { await refreshMembers(); onChanged(); }} />}

      {editing && (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">What the family calls them</span>
            <input className={cn(field, "bg-white")} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">Generation</span>
            <select className={cn(field, "bg-white")} value={role} onChange={(e) => setRole(e.target.value as Member["role"])}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">Where they live</span>
            <select className={cn(field, "bg-white")} value={tz} onChange={(e) => setTz(e.target.value)}>
              {Array.from(new Set([tz, ...ZONES.map((z) => z.tz)])).map((z) => (
                <option key={z} value={z}>
                  {placeFromTz(z)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2">
            <select aria-label="Birthday month" className={cn(field, "bg-white !px-4")} value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Birthday month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1).padStart(2, "0")}>
                  {m}
                </option>
              ))}
            </select>
            <select aria-label="Birthday day" className={cn(field, "bg-white !px-4")} value={day} onChange={(e) => setDay(e.target.value)}>
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
                <option key={d} value={d}>
                  {Number(d)}
                </option>
              ))}
            </select>
            <BirthYearField value={year} onChange={setYear} className="!px-4" />
          </div>
          <p className="m-0 text-[13px] text-ink-soft">The year is optional. With it, Aangan can show {callName(person)}&rsquo;s age.</p>
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" disabled={busy || !name.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="secondary" className="flex-1 !bg-white" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {removable && !editing && (
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          {!confirm ? (
            <button type="button" onClick={() => setConfirm(true)} className="h-11 text-[15px] font-medium text-[#b42318]">
              Remove from the family tree
            </button>
          ) : (
            <div role="alertdialog" aria-label="Confirm removal">
              <p className="m-0 text-[15px]">
                Remove {callName(person)}? Their place in the tree and anything saved about them goes too. Voice notes and photos others shared stay.
                {hasAccount ? " They'll lose access to the family." : ""}
              </p>
              <div className="mt-3 flex gap-2">
                <Button className="flex-1 !bg-[#b42318]" disabled={busy} onClick={() => void remove()}>
                  {busy ? "Removing…" : "Remove"}
                </Button>
                <Button variant="secondary" className="flex-1 !bg-white" onClick={() => setConfirm(false)}>
                  Keep
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="m-0 mt-3 text-[14px] text-[#b42318]" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

const LINK_WORDS = ["wife", "husband", "mother", "father", "daughter", "son", "sister", "brother"];

/**
 * How this person is connected, in plain words, with a way to fix it:
 * remove a wrong link, or link them to someone already in the family.
 */
function Connections({ person, members, relationships, canEdit, canAdd, onChanged }: { person: Member; members: Member[]; relationships: Relationship[]; canEdit: boolean; canAdd: boolean; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [word, setWord] = useState("wife");
  const [other, setOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => callName(members.find((m) => m.id === id));
  const mine = relationships.filter((r) => r.memberId === person.id || r.relationMemberId === person.id);
  // Edge (A, B, "mother") means B is A's mother.
  const line = (r: Relationship) => `${name(r.relationMemberId)} is ${name(r.memberId)}'s ${r.relation}`;
  const others = members.filter((m) => m.id !== person.id);
  return (
    <div className="mt-4">
      <p className="m-0 mb-1.5 text-[13px] font-medium text-ink-soft">Connections</p>
      {mine.length === 0 && <p className="m-0 text-[14px] text-ink-soft">Not connected to anyone yet.</p>}
      <ul className="m-0 list-none space-y-1 p-0">
        {mine.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-[14px] bg-white px-3 py-2 text-[14px]">
            <span>{line(r)}</span>
            {canEdit && (
              <button
                type="button"
                aria-label={`Remove: ${line(r)}`}
                className="press grid h-8 w-8 place-items-center rounded-full text-ink-faint"
                onClick={async () => {
                  await fetch(`/api/relationships/${encodeURIComponent(r.id)}`, { method: "DELETE" });
                  await onChanged();
                }}
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canAdd && !adding && (
        <button type="button" onClick={() => setAdding(true)} className="press mt-2 flex h-10 items-center gap-1.5 text-[14px] font-semibold">
          <Icon name="plus" size={16} />
          Link to someone already here
        </button>
      )}
      {adding && (
        <div className="mt-2 rounded-[16px] bg-white p-3">
          <p className="m-0 mb-1.5 text-[13px] text-ink-soft">{callName(person)} is the</p>
          <div className="flex flex-wrap gap-1.5">
            {LINK_WORDS.map((w) => (
              <button key={w} type="button" aria-pressed={word === w} onClick={() => setWord(w)} className={cn("press h-9 rounded-full px-3 text-[14px] font-medium", word === w ? "bg-black text-white" : "bg-surface")}>
                {w}
              </button>
            ))}
          </div>
          <p className="m-0 mb-1.5 mt-2.5 text-[13px] text-ink-soft">of</p>
          <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3">
            {others.map((m) => (
              <button key={m.id} type="button" aria-pressed={other === m.id} onClick={() => setOther(m.id)} className={cn("press flex h-10 shrink-0 items-center gap-1.5 rounded-full pl-1 pr-3 text-[14px] font-medium", other === m.id ? "bg-black text-white" : "bg-surface")}>
                <Avatar src={memberPhoto(m)} name={callName(m)} size={30} />
                {callName(m)}
              </button>
            ))}
          </div>
          {error && <p className="m-0 mt-2 text-[13px] text-[#b42318]">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button
              className="h-11 flex-1 text-[15px]"
              disabled={!other}
              onClick={async () => {
                setError(null);
                // "Papa is Maa's husband" → edge (Maa, Papa, "husband").
                const res = await fetch("/api/relationships/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId: other, relationMemberId: person.id, relation: word }) });
                if (res.status === 409) return setError("They're already connected.");
                if (!res.ok) return setError("Couldn't link them. Try again.");
                setAdding(false);
                setOther("");
                await onChanged();
              }}
            >
              Link
            </Button>
            <Button variant="secondary" className="h-11 flex-1 text-[15px]" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
