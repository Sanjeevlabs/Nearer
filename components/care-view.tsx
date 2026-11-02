"use client";

import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useShell } from "@/components/shell";
import { Translated } from "@/components/translated";
import { ActionMenu, Avatar, Button, EmptyLine, Icon, MuseMark, RoomHeader, SectionTitle, SuggestionTile, type IconName } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { householdName, householdOf, households, type Household } from "@/lib/households";
import { HELPER_ROLES, NEED_KINDS, PRIORITIES, RECURRENCE } from "@/lib/kind-values";
import type { Helper, Need, Pet } from "@/lib/kinds";
import { language } from "@/lib/languages";
import { everydayHelpers, telHref, waHref } from "@/lib/nearby";
import { can } from "@/lib/permissions";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { ago, postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { BottomSheet } from "./ui/bottom-sheet";
import { placeFromTz, timeIn } from "@/lib/zones";

// Care: one shared task list for each parent's home. Anyone (the parents too)
// says or types a task; a sibling or the admin picks it up, or hands it to
// someone. Local helpers (the grocer, the driver) have their own page
// (/care/helpers); both share this view, one list each.
// Tasks only; no medical, legal or money advice.

interface CareData {
  needs: Need[];
  helpers: Helper[];
}
type Kind = (typeof NEED_KINDS)[number];
type Filter = "all" | "mine" | "unassigned" | "urgent";

const KIND_LABEL: Record<Kind, string> = {
  groceries: "Groceries",
  house: "House",
  ride: "Ride",
  repair: "Repair",
  gas: "Gas & utilities",
  bills: "Bills",
  health: "Health visit",
  errand: "Errand",
  visit: "A visit",
  pets: "Pets",
  other: "Other",
};
const PRIORITY_LABEL: Record<(typeof PRIORITIES)[number], string> = { normal: "Normal", soon: "Soon", urgent: "Urgent" };
const REPEAT_LABEL: Record<(typeof RECURRENCE)[number], string> = { none: "Once", weekly: "Weekly", monthly: "Monthly" };
const STATUS_LABEL: Record<Need["status"], string> = { open: "To do", claimed: "Assigned", progress: "In progress", done: "Done", cancelled: "Cancelled" };
const FILTER_LABEL: Record<Filter, string> = { all: "All", mine: "Mine", unassigned: "Unassigned", urgent: "Urgent" };
/** The asks families make most: each opens a new task of that kind. */
const QUICK_KINDS: { kind: Kind; icon: IconName }[] = [
  { kind: "groceries", icon: "basket" },
  { kind: "repair", icon: "wrench" },
  { kind: "ride", icon: "car" },
  { kind: "health", icon: "care" },
];
const ROLE_ICON: Partial<Record<Helper["role"], IconName>> = { groceries: "basket", driver: "car", cook: "utensils", plumber: "wrench", electrician: "plug", repairs: "wrench", caregiver: "care", "house help": "village", "gas booking": "pot", neighbour: "village" };
/** Who a home usually needs nearby, offered when they aren't in the book yet. */
const ROLE_SUGGEST: Helper["role"][] = ["groceries", "driver", "plumber", "electrician", "cook", "caregiver"];
const chip = (on: boolean) =>
  cn(
    "press relative h-10 shrink-0 rounded-full px-4 text-body font-medium before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-['']",
    on ? "bg-black text-white" : "bg-card shadow-card",
  );
const field = "h-12 w-full rounded-[14px] bg-well px-4 text-body outline-none ring-1 ring-black/5 focus:ring-2 focus:ring-black/30";

export function CareView({ tab }: { tab: "tasks" | "helpers" }) {
  const pageTitle = tab === "tasks" ? "Care tasks" : "Local helpers";
  const { viewer, members, relationships, ready } = useViewer();
  // Times and "2 h ago" differ between server and client render: client only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const care = useJson<CareData>("/api/care");
  const petsQ = useJson<{ pets: Pet[] }>("/api/pets");
  const homes = households(members, relationships).filter((h) => h.elders);
  const [chosen, setChosen] = useState<string | null>(null);
  const home = homes.find((h) => h.id === chosen) ?? (viewer.role === "elder" ? householdOf(viewer.id, homes) : undefined) ?? homes.find((h) => !h.members.some((x) => x.id === viewer.id)) ?? homes[0];

  // Until the family has loaded, homes come from the seeded demo people and the home switcher would appear, then go.
  if (!mounted || !ready)
    return (
      <div>
        <RoomHeader title={pageTitle} />
        <div key="loading" className="skeleton h-[320px] rounded-card" aria-busy="true" aria-label="Loading care" />
      </div>
    );
  if (!home) {
    return (
      <div>
        <RoomHeader title={pageTitle} />
        <div className="rounded-card bg-card px-6 py-10 text-center shadow-card">
          <p className="m-0 text-headline font-semibold">Add a parent or grandparent first</p>
          <p className="mx-auto mt-2 max-w-[300px] text-body text-ink-soft">Care forms around the homes of the elders in your family tree.</p>
        </div>
      </div>
    );
  }
  const ids = home.members.map((x) => x.id);
  const isParent = ids.includes(viewer.id) && viewer.role === "elder";
  const parent = home.members.find((x) => x.id === viewer.id && x.role === "elder") ?? home.members.find((x) => x.role === "elder") ?? home.members[0];
  const data = care.data;
  const needs = (data?.needs ?? []).filter((n) => ids.includes(n.forMemberId));
  const helpers = (data?.helpers ?? []).filter((h) => ids.includes(h.forMemberId));
  const pets = (petsQ.data?.pets ?? []).filter((p) => ids.includes(p.livesWith));

  return (
    <div>
      <RoomHeader title={pageTitle} subtitle={`${isParent ? "Your home" : householdName(home, (x) => callName(x))} · ${timeIn(home.tz)} in ${placeFromTz(home.tz)}`} />

      {!isParent && homes.length > 1 && (
        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 py-1">
          {homes.map((h) => (
            <button key={h.id} type="button" onClick={() => setChosen(h.id)} aria-pressed={h.id === home.id} className={cn("press flex h-11 shrink-0 items-center gap-2 rounded-full pl-1 pr-4 text-body font-medium", h.id === home.id ? "bg-black text-white" : "bg-card shadow-card")}>
              <span className="flex -space-x-2">
                {h.members.slice(0, 2).map((x) => (
                  <Avatar key={x.id} src={memberPhoto(x)} name={callName(x)} size={30} />
                ))}
              </span>
              {householdName(h, (x) => callName(x))}
            </button>
          ))}
        </div>
      )}

      {care.failed && !data ? (
        <div className="rounded-card bg-card px-4 py-8 text-center shadow-card">
          <p className="m-0 text-body text-ink-soft">Couldn&rsquo;t load care right now.</p>
          <Button variant="secondary" className="mx-auto mt-3 !h-11 !bg-well" onClick={() => void care.reload()}>
            Try again
          </Button>
        </div>
      ) : !data || (!petsQ.data && !petsQ.failed) ? (
        <div key="loading" className="skeleton h-[320px] rounded-card" aria-busy="true" aria-label="Loading care" />
      ) : tab === "tasks" ? (
        <Tasks home={home} parent={parent} isParent={isParent} needs={needs} helpers={helpers} pets={pets} onChange={care.reload} />
      ) : (
        <Helpers parent={parent} helpers={helpers} needs={needs} canManage={can(viewer, "care.manage")} onChange={care.reload} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- tasks */
function Tasks({ home, parent, isParent, needs, helpers, pets, onChange }: { home: Household; parent: Member; isParent: boolean; needs: Need[]; helpers: Helper[]; pets: Pet[]; onChange: () => void }) {
  const { viewer } = useViewer();
  const { openAdd } = useShell();
  const manage = can(viewer, "care.manage");
  // Parents always may ask for themselves; siblings and the admin run the list.
  const mayAdd = manage || isParent;
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftKind, setDraftKind] = useState<Kind | undefined>(undefined);
  // null = not chosen yet: open by default while the open list is short, so the page isn't half empty.
  const [showDoneChoice, setShowDone] = useState<boolean | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const live = needs.filter((n) => n.status !== "done" && n.status !== "cancelled");
  const passes = (n: Need) => filter === "all" || (filter === "mine" && n.claimedBy === viewer.id) || (filter === "unassigned" && !n.claimedBy) || (filter === "urgent" && n.priority === "urgent");
  const order = (a: Need, b: Need) => rank(b.priority) - rank(a.priority) || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9") || b.createdAt.localeCompare(a.createdAt);
  const todo = live.filter((n) => n.status !== "progress").filter(passes).sort(order);
  const doing = live.filter((n) => n.status === "progress").filter(passes).sort(order);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const done = needs.filter((n) => n.status === "done" && Date.parse(n.doneAt ?? n.createdAt) > weekAgo).filter(passes);
  const counts: Record<Filter, number> = { all: live.length, mine: live.filter((n) => n.claimedBy === viewer.id).length, unassigned: live.filter((n) => !n.claimedBy).length, urgent: live.filter((n) => n.priority === "urgent").length };
  const selected = needs.find((n) => n.id === openId);
  const showDone = showDoneChoice ?? todo.length + doing.length <= 3;

  const quickAdd = async () => {
    const t = title.trim();
    if (t.length < 3) return setCreating(true);
    setBusy(true);
    const out = await postJson("/api/care", { action: "need", forMemberId: parent.id, title: t });
    setBusy(false);
    if (!out) return setErr("Couldn't add it. Try again.");
    setErr(null);
    setTitle("");
    onChange();
  };
  const act = async (body: Record<string, unknown>) => {
    await postJson("/api/care", body);
    onChange();
  };

  return (
    <section aria-label="Tasks">
      {mayAdd && (
        <div className="flex items-center gap-2 rounded-[24px] bg-card p-2 shadow-card">
          <button type="button" onClick={() => openAdd("voice", { kind: "need", forMemberId: parent.id })} aria-label="Say a task" className="press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-black text-white">
            <Icon name="mic" size={24} />
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            onKeyDown={(e) => e.key === "Enter" && void quickAdd()}
            placeholder={isParent ? "What do you need?" : "Add a task: the geyser, groceries…"}
            aria-label="New task"
            className="h-12 min-w-0 flex-1 bg-transparent px-1 text-body outline-none placeholder:text-ink-faint"
          />
          <button type="button" disabled={busy} onClick={() => void quickAdd()} aria-label={title.trim().length >= 3 ? "Add task" : "New task with details"} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-well disabled:opacity-40">
            <Icon name="plus" size={20} />
          </button>
        </div>
      )}
      {err && <p className="m-0 mt-2 px-2 text-footnote text-[#a3271b]" role="alert">{err}</p>}

      <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 py-1" role="radiogroup" aria-label="Filter">
        {(["all", "mine", "unassigned", "urgent"] as const).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={chip(filter === f)}>
            {FILTER_LABEL[f]}
            {counts[f] ? <span className={cn("ml-1.5 tnum", filter === f ? "text-white/70" : "text-ink-soft")}>{counts[f]}</span> : null}
          </button>
        ))}
      </div>

      <Lane title="Open" items={todo} onOpen={setOpenId} manage={manage} act={act} empty={live.length === 0 ? (mayAdd ? "Nothing to do. Say or type the next thing." : "Nothing to do right now.") : "Nothing here with this filter."} />
      {doing.length > 0 && <Lane title="In progress" items={doing} onOpen={setOpenId} manage={manage} act={act} />}
      {done.length > 0 && (
        <div className="mt-5">
          <button type="button" onClick={() => setShowDone(!showDone)} aria-expanded={showDone} className="flex h-11 items-center gap-1.5 text-footnote font-semibold uppercase tracking-[0.06em] text-ink-soft">
            Done this week · {done.length}
            <Icon name="down" size={16} className={cn("transition-transform", showDone && "rotate-180")} />
          </button>
          {showDone && <Lane items={done} onOpen={setOpenId} manage={manage} act={act} muted />}
        </div>
      )}

      {mayAdd && (
        <section aria-label="Start a task">
          <SectionTitle>Start a task</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_KINDS.map((q) => (
              <SuggestionTile
                key={q.kind}
                icon={q.icon}
                title={KIND_LABEL[q.kind]}
                onClick={() => {
                  setDraftKind(q.kind);
                  setCreating(true);
                }}
              />
            ))}
          </div>
        </section>
      )}

      <AnimatePresence>
        {(selected || creating) && (
          <TaskSheet
            key={selected?.id ?? "new"}
            need={selected}
            home={home}
            draft={creating ? title : ""}
            draftKind={creating ? draftKind : undefined}
            helpers={helpers}
            pets={pets}
            onClose={() => {
              setOpenId(null);
              if (creating) setTitle("");
              setCreating(false);
              setDraftKind(undefined);
            }}
            onChange={onChange}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function rank(p: Need["priority"]): number {
  return p === "urgent" ? 2 : p === "soon" ? 1 : 0;
}

function Lane({ title, items, onOpen, manage, act, empty, muted }: { title?: string; items: Need[]; onOpen: (id: string) => void; manage: boolean; act: (body: Record<string, unknown>) => Promise<void>; empty?: string; muted?: boolean }) {
  return (
    <div className={title ? "mt-5" : "mt-1"}>
      {title && (
        <p className="m-0 mb-2 text-footnote font-semibold uppercase tracking-[0.06em] text-ink-soft">
          {title} · {items.length}
        </p>
      )}
      {items.length === 0 && empty ? <p className="m-0 rounded-card bg-card px-4 py-6 text-center text-body text-ink-soft shadow-card">{empty}</p> : null}
      {items.length > 0 && (
        <ul className="m-0 list-none divide-y divide-[var(--line)] overflow-hidden rounded-card bg-card p-0 shadow-card">
          {items.map((n) => (
            <TaskRow key={n.id} need={n} onOpen={() => onOpen(n.id)} manage={manage} act={act} muted={muted} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskRow({ need, onOpen, manage, act, muted }: { need: Need; onOpen: () => void; manage: boolean; act: (body: Record<string, unknown>) => Promise<void>; muted?: boolean }) {
  const { viewer, members } = useViewer();
  const [busy, setBusy] = useState(false);
  const who = members.find((x) => x.id === need.claimedBy);
  const forWhom = members.find((x) => x.id === need.forMemberId);
  const due = need.dueAt ? dueLabel(need.dueAt) : need.when;
  const live = need.status !== "done" && need.status !== "cancelled";
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    await act(body);
    setBusy(false);
  };
  return (
    <li className="flex items-center gap-1.5 pr-2">
      <button type="button" onClick={onOpen} className="press flex min-h-[56px] min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", need.priority === "urgent" ? "bg-[#d92d20]" : need.priority === "soon" ? "bg-[#d99a1e]" : "bg-black/15")} aria-label={`${PRIORITY_LABEL[need.priority]} priority`} />
        <span className="min-w-0 flex-1">
          <span className={cn("line-clamp-2 block text-body font-semibold leading-snug", muted && "text-ink-soft line-through decoration-black/20")}>
            <Translated text={need.title} />
          </span>
          <span className="mt-0.5 block truncate text-callout text-ink-soft">
            {[who ? (who.id === viewer.id ? "You" : callName(who)) : "Unassigned", due, forWhom ? `for ${callName(forWhom)}` : "", need.recurring !== "none" ? REPEAT_LABEL[need.recurring].toLowerCase() : ""].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      {who && <Avatar src={memberPhoto(who)} name={who.id === viewer.id ? "You" : callName(who)} size={28} />}
      {manage && live && need.claimedBy !== viewer.id && (
        <button type="button" disabled={busy} onClick={() => void run({ action: "claim", needId: need.id })} aria-label={`Pick up: ${need.title}`} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-well disabled:opacity-40">
          <Icon name="pickUp" size={18} />
        </button>
      )}
      {live && (
        <Link href={`/send?for=${encodeURIComponent(need.forMemberId)}&kind=need&title=${encodeURIComponent(need.title)}`} aria-label={`Send something for: ${need.title}`} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-well text-ink no-underline">
          <Icon name="send" size={17} />
        </Link>
      )}
      {manage && live && (
        <button type="button" disabled={busy} onClick={() => void run({ action: "done", needId: need.id })} aria-label={`Mark done: ${need.title}`} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black text-white disabled:opacity-40">
          <Icon name="check" size={18} />
        </button>
      )}
    </li>
  );
}

function dueLabel(iso: string): string {
  const d = new Date(iso);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : days < 0 ? `${-days} days late` : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `due ${day}`;
}

/* -------------------------------------------------------------- task sheet */
/** Edit, assign, change status, delete, and the timeline. Also "new task with details". */
function TaskSheet({ need, home, draft, draftKind, helpers, pets, onClose, onChange }: { need?: Need; home: Household; draft: string; draftKind?: Kind; helpers: Helper[]; pets: Pet[]; onClose: () => void; onChange: () => void }) {
  const { viewer, members } = useViewer();
  const manage = can(viewer, "care.manage");
  const elders = home.members.filter((x) => x.role === "elder");
  const family = members.filter((x) => can(x, "care.write")).sort((a, b) => Number(b.id === viewer.id) - Number(a.id === viewer.id));
  const mayEdit = !need || manage || need.askedBy === viewer.id || need.forMemberId === viewer.id;
  const [title, setTitle] = useState(need?.title ?? draft);
  const [kind, setKind] = useState<Kind>(need?.kind ?? draftKind ?? "other");
  const [priority, setPriority] = useState<Need["priority"]>(need?.priority ?? "normal");
  const [recurring, setRecurring] = useState<Need["recurring"]>(need?.recurring ?? "none");
  const [due, setDue] = useState(need?.dueAt ? toLocalInput(need.dueAt) : "");
  const [forId, setForId] = useState(need?.forMemberId ?? (elders.some((x) => x.id === viewer.id) ? viewer.id : elders[0]?.id ?? home.members[0].id));
  const [assignee, setAssignee] = useState<string | null>(need?.claimedBy ?? null);
  const [petId, setPetId] = useState<string | null>(need?.petId ?? null);
  const [busy, setBusy] = useState(false);
  const name = (id: string | null) => (id === viewer.id ? "You" : callName(members.find((x) => x.id === id)));
  const dirty = Boolean(need) && (title !== need?.title || kind !== need?.kind || priority !== need?.priority || recurring !== need?.recurring || due !== (need?.dueAt ? toLocalInput(need.dueAt) : ""));
  const parent = members.find((x) => x.id === forId);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    await postJson("/api/care", body);
    setBusy(false);
    onChange();
  };
  const create = async () => {
    setBusy(true);
    await postJson("/api/care", { action: "need", forMemberId: forId, title: title.trim(), kind, priority, recurring, dueAt: due ? new Date(due).toISOString() : null, assignee: manage ? assignee : null, petId });
    setBusy(false);
    onChange();
    onClose();
  };

  return (
    <BottomSheet open onClose={onClose} title={need ? "Task" : "New task"} dataUi="care-task-sheet" z={50}>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="m-0 text-footnote font-semibold uppercase tracking-[0.06em] text-ink-faint">{need ? STATUS_LABEL[need.status] : "Add it to the list"}</p>
          {need && mayEdit && (
            <button
              type="button"
              aria-label="Delete task"
              disabled={busy}
              onClick={async () => {
                await act({ action: "need-delete", needId: need.id });
                onClose();
              }}
              className="press grid h-11 w-11 place-items-center rounded-full text-ink-soft"
            >
              <Icon name="trash" size={18} />
            </button>
          )}
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="What needs doing?"
          aria-label="Task"
          disabled={!mayEdit}
          className="w-full border-0 bg-transparent text-title font-semibold outline-none placeholder:text-ink-faint"
        />

        {mayEdit && (
          <div className="mt-3 space-y-2.5">
            <Row label="Kind">
              <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="h-10 rounded-full bg-surface px-3 text-callout font-semibold" aria-label="Kind">
                {NEED_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </Row>
            {elders.length > 1 && (
              <Row label="For">
                <div className="flex gap-1.5">
                  {elders.map((x) => (
                    <button key={x.id} type="button" aria-pressed={forId === x.id} onClick={() => setForId(x.id)} disabled={Boolean(need)} className={cn("press h-10 rounded-full px-3.5 text-callout font-semibold", forId === x.id ? "bg-black text-white" : "bg-surface", need && "opacity-60")}>
                      {callName(x)}
                    </button>
                  ))}
                </div>
              </Row>
            )}
            {kind === "pets" && pets.length > 0 && (
              <Row label="Pet">
                <select value={petId ?? ""} onChange={(e) => setPetId(e.target.value || null)} className="h-10 rounded-full bg-surface px-3 text-callout font-semibold" aria-label="Pet">
                  <option value="">Choose</option>
                  {pets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Row>
            )}
            <Row label="Priority">
              <Segmented value={priority} options={PRIORITIES} labels={PRIORITY_LABEL} onChange={setPriority} />
            </Row>
            <Row label="Due">
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="h-10 rounded-full bg-surface px-3 text-callout" aria-label="Due" />
            </Row>
            <Row label="Repeats">
              <Segmented value={recurring} options={RECURRENCE} labels={REPEAT_LABEL} onChange={setRecurring} />
            </Row>
          </div>
        )}

        {need && dirty && (
          <Button className="mt-4 w-full" disabled={busy || title.trim().length < 3} onClick={() => act({ action: "need-edit", needId: need.id, title: title.trim(), kind, priority, recurring, dueAt: due ? new Date(due).toISOString() : null, when: need.when })}>
            Save changes
          </Button>
        )}

        {manage && (
          <>
            <SectionTitle>Who&rsquo;s on it</SectionTitle>
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
              {family.map((x) => {
                const on = (need ? need.claimedBy : assignee) === x.id;
                return (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => (need ? void act({ action: x.id === viewer.id ? "claim" : "assign-to", needId: need.id, memberId: x.id }) : setAssignee(on ? null : x.id))}
                    className={cn("press flex h-11 shrink-0 items-center gap-2 rounded-full pl-1 pr-4 text-callout font-semibold", on ? "bg-black text-white" : "bg-surface")}
                  >
                    <Avatar src={memberPhoto(x)} name={callName(x)} size={32} />
                    {x.id === viewer.id ? "Me" : callName(x)}
                  </button>
                );
              })}
            </div>
            {helpers.length > 0 && need && (
              <select
                aria-label="Local helper who will go"
                disabled={busy}
                value={need.helperId ?? ""}
                onChange={(e) => e.target.value && void act({ action: "assign", needId: need.id, helperId: e.target.value })}
                className="mt-3 h-11 w-full rounded-full bg-surface px-4 text-callout font-semibold"
              >
                <option value="">Send a local helper?</option>
                {helpers.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} · {h.role}
                  </option>
                ))}
              </select>
            )}
          </>
        )}

        {need ? (
          <>
            {manage && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {need.status === "done" || need.status === "cancelled" ? (
                  <button type="button" disabled={busy} onClick={() => act({ action: "status", needId: need.id, status: "open" })} className="press col-span-3 h-11 rounded-full bg-surface text-callout font-semibold">
                    Re-open
                  </button>
                ) : (
                  <>
                    <button type="button" disabled={busy || need.status === "progress"} onClick={() => act({ action: "status", needId: need.id, status: "progress" })} className="press h-11 rounded-full bg-surface text-callout font-semibold disabled:opacity-40">
                      Start
                    </button>
                    <button type="button" disabled={busy} onClick={() => act({ action: "status", needId: need.id, status: "done" })} className="press h-11 rounded-full bg-black text-callout font-semibold text-white">
                      Done
                    </button>
                    <button type="button" disabled={busy} onClick={() => act({ action: "status", needId: need.id, status: "cancelled" })} className="press h-11 rounded-full bg-surface text-callout font-semibold text-ink-soft">
                      Cancel
                    </button>
                  </>
                )}
              </div>
            )}
            {need.noteForParent && (
              <div className="mt-4 rounded-[18px] bg-surface px-4 py-3">
                <p className="voice m-0 text-headline leading-snug">{need.noteForParent}</p>
                <MuseMark>
                  what {callName(parent)} sees, in {language(parent?.displayLang ?? "en").native}
                </MuseMark>
              </div>
            )}
            <details className="mt-4">
              <summary className="cursor-pointer text-callout font-semibold text-ink-soft">Timeline · {need.history.length || 1}</summary>
              <ol className="m-0 mt-3 list-none space-y-2.5 border-l-2 border-[var(--line)] p-0 pl-4">
                {[...need.history].reverse().map((h, i) => (
                  <li key={i} className="relative text-callout">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-black/20" aria-hidden="true" />
                    <span className="font-medium">{h.what}</span>
                    <span className="block text-caption text-ink-faint">
                      {name(h.by)} · {ago(h.at)}
                    </span>
                  </li>
                ))}
                {need.history.length === 0 && (
                  <li className="text-callout text-ink-soft">
                    Asked {ago(need.createdAt)} by {name(need.askedBy)}
                  </li>
                )}
              </ol>
            </details>
          </>
        ) : (
          <Button className="mt-6 w-full" disabled={busy || title.trim().length < 3} onClick={() => void create()}>
            {busy ? "Adding…" : assignee && manage ? `Add and give to ${name(assignee)}` : "Add task"}
          </Button>
        )}
      </div>
    </BottomSheet>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-callout text-ink-soft">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, options, labels, onChange }: { value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full bg-surface p-0.5" role="radiogroup">
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)} className={cn("press h-9 rounded-full px-3 text-footnote font-semibold", value === o ? "bg-white shadow-sm" : "text-ink-soft")}>
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- local helpers */
/**
 * The home's contacts nearby (grocer, driver, house help, plumber). A contact
 * book the whole family shares, so whoever picks up a task can call the right
 * person. Calls use the phone's own dialer.
 */
function Helpers({ parent, helpers, needs, canManage, onChange }: { parent: Member; helpers: Helper[]; needs: Need[]; canManage: boolean; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [addRole, setAddRole] = useState<Helper["role"] | undefined>(undefined);
  const missing = ROLE_SUGGEST.filter((r) => !helpers.some((h) => h.role === r)).slice(0, 4);
  const [editing, setEditing] = useState<string | null>(null);
  // The first-to-call list (helper.emergency) lives on Nearby, not here too.
  const shown = useMemo(() => [...everydayHelpers(helpers)].sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)), [helpers]);
  const jobs = (id: string) => needs.filter((n) => n.helperId === id && n.status === "done").length;
  return (
    <section aria-label="Local helpers">
      {shown.length === 0 && !adding && (
        <div className="rounded-card bg-card px-4 shadow-card">
          <EmptyLine>No one yet. Start with whoever delivers groceries.</EmptyLine>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="m-0 list-none divide-y divide-[var(--line)] rounded-card bg-card p-0 px-4 shadow-card">
          {shown.map((h) => {
            const done = jobs(h.id);
            const meta = [h.role, h.hours, done ? `helped ${done}×` : ""].filter(Boolean).join(" · ");
            return (
              <Fragment key={h.id}>
                <li className="flex min-h-[56px] items-center gap-2 py-3">
                  <Avatar src={null} name={h.name} size={40} />
                  <span className="ml-1 min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold leading-tight">{h.name}</span>
                    <span className="mt-0.5 block truncate text-callout text-ink-soft first-letter:uppercase">{meta}</span>
                  </span>
                  {h.phone && (
                    <>
                      <a href={waHref(h.phone)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${h.name}`} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-well text-ink">
                        <Icon name="whatsapp" size={17} />
                      </a>
                      <a href={telHref(h.phone)} aria-label={`Call ${h.name}`} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black text-white">
                        <Icon name="phone" size={16} />
                      </a>
                    </>
                  )}
                  {canManage && (
                    <ActionMenu
                      label={`${h.name} options`}
                      actions={[
                        { label: "Edit", onSelect: () => setEditing(h.id) },
                        { label: "Remove", danger: true, confirm: `Remove ${h.name}?`, onSelect: async () => { await postJson("/api/care", { action: "helper-remove", helperId: h.id }); onChange(); } },
                      ]}
                    />
                  )}
                </li>
                {editing === h.id && (
                  <li className="py-3">
                    <HelperForm helper={h} forMemberId={h.forMemberId} onDone={() => { setEditing(null); onChange(); }} />
                  </li>
                )}
              </Fragment>
            );
          })}
        </ul>
      )}
      <Link href="/nearby" replace className="mt-3 flex min-h-[44px] items-center gap-1 text-callout font-medium text-ink-soft no-underline">
        <Icon name="shield" size={15} /> Your first-to-call list is in Nearby <Icon name="chevron" size={14} />
      </Link>
      {canManage &&
        (adding ? (
          <div className="mt-3">
            <HelperForm key={addRole ?? "any"} role={addRole} forMemberId={parent.id} onDone={() => { setAdding(false); setAddRole(undefined); onChange(); }} />
          </div>
        ) : (
          <>
            <button type="button" onClick={() => setAdding(true)} className="press mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-card border-2 border-dashed border-black/[.12] text-body font-semibold text-ink">
              <Icon name="plus" size={18} />
              Add a local helper
            </button>
            {missing.length > 0 && (
              <section aria-label="Add someone who helps">
                <SectionTitle>Add someone who helps</SectionTitle>
                <div className="grid grid-cols-2 gap-3">
                  {missing.map((r) => (
                    <SuggestionTile
                      key={r}
                      icon={ROLE_ICON[r] ?? "contacts"}
                      title={r.charAt(0).toUpperCase() + r.slice(1)}
                      onClick={() => {
                        setAddRole(r);
                        setAdding(true);
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        ))}
      <div className="mt-6 flex items-center gap-3 rounded-card bg-well p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card">
          <Icon name="phone" size={18} strokeWidth={1.8} />
        </span>
        <p className="m-0 text-body leading-snug text-ink-soft">One contact book for the family: whoever picks up a task can call the right person.</p>
      </div>
    </section>
  );
}

interface PickedContact {
  name?: string[];
  tel?: string[];
}
/** Android Chrome can pick from the phone's contacts; elsewhere it's typed. */
function canPickContacts(): boolean {
  return typeof navigator !== "undefined" && "contacts" in navigator && typeof (navigator as Navigator & { contacts?: { select?: unknown } }).contacts?.select === "function";
}

function HelperForm({ helper, role: preset, forMemberId, onDone }: { helper?: Helper; role?: Helper["role"]; forMemberId: string; onDone: () => void }) {
  const [name, setName] = useState(helper?.name ?? "");
  const [role, setRole] = useState<Helper["role"]>(helper?.role ?? preset ?? "groceries");
  const [phone, setPhone] = useState(helper?.phone ?? "");
  const [hours, setHours] = useState(helper?.hours ?? "");
  const [note, setNote] = useState(helper?.note ?? "");
  const [picker, setPicker] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setPicker(canPickContacts()), []);
  const pick = async () => {
    try {
      const contacts = (navigator as Navigator & { contacts: { select: (p: string[], o: { multiple: boolean }) => Promise<PickedContact[]> } }).contacts;
      const [c] = await contacts.select(["name", "tel"], { multiple: false });
      if (c?.name?.[0]) setName(c.name[0].slice(0, 60));
      if (c?.tel?.[0]) setPhone(c.tel[0].replace(/[^+\d\s()-]/g, "").slice(0, 30));
    } catch {
      /* the person closed the picker */
    }
  };
  return (
    <div className="space-y-2 rounded-[22px] bg-card p-4 shadow-card">
      {picker && !helper && (
        <button type="button" onClick={() => void pick()} className="press flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-well text-body font-semibold">
          <Icon name="contacts" size={16} />
          Pick from my contacts
        </button>
      )}
      <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Name (Ramesh, Sunita didi…)" aria-label="Name" />
      <div className="flex gap-2">
        <select className={field} value={role} onChange={(e) => setRole(e.target.value as Helper["role"])} aria-label="What they help with">
          {HELPER_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input className={field} value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^+\d\s()-]/g, ""))} inputMode="tel" maxLength={30} placeholder="+91…" aria-label="Phone" />
      </div>
      <input className={field} value={hours} onChange={(e) => setHours(e.target.value)} maxLength={60} placeholder="When they're available (Mon–Sat, 8–11 am)" aria-label="Available" />
      <input className={field} value={note} onChange={(e) => setNote(e.target.value)} maxLength={160} placeholder="A note (Knows the way to the clinic)" aria-label="Note" />
      {err && <p className="m-0 px-1 text-footnote text-[#a3271b]" role="alert">{err}</p>}
      <div className="flex gap-2">
        <Button
          className="h-11 flex-1 text-body"
          disabled={!name.trim()}
          onClick={async () => {
            const fields = { name: name.trim(), role, phone: phone.trim(), hours: hours.trim(), note: note.trim() };
            const out = await postJson("/api/care", helper ? { action: "helper-edit", helperId: helper.id, ...fields } : { action: "helper", forMemberId, ...fields });
            if (!out) return setErr("Couldn't save. Check the phone number.");
            onDone();
          }}
        >
          {helper ? "Save" : "Add"}
        </Button>
        <Button variant="secondary" className="h-11 flex-1 !bg-well text-body" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
