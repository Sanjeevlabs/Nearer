"use client";

import { useEffect, useMemo, useState } from "react";
import { pickerView, type PickerRow } from "@/lib/picker-rows";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { useT } from "@/lib/use-t";
import { cn } from "@/lib/utils";
import { BottomSheet } from "./ui/bottom-sheet";
import { Avatar, Icon } from "./ui/kit";
import { useViewer } from "./viewer";

// Who is this for? ONE picker for voice notes, used by the dock mic and the
// composer. Everyone, then whole homes, then up to two people waiting for your
// reply, then a search for the rest. One tap sends to that choice; in the
// composer ("multi") taps pick a mix of people and Done confirms.
// Never assumes the other side is "Maa and Papa": any family fits.

export function PeoplePicker({
  open,
  people,
  everyoneLabel,
  status,
  waitingIds,
  onPick,
  onClose,
  multi,
}: {
  open: boolean;
  /** Kept for callers; the header always asks "Who is it for?". */
  title?: string;
  people: Member[];
  everyoneLabel?: string;
  /** Optional dot on a person's photo (their status colour). */
  status?: (m: Member) => { text: string; dot?: string } | null;
  /** Who is waiting for the viewer's reply: they come first, marked. */
  waitingIds?: Iterable<string>;
  /** One tap: the ids to send to (everyone = all of them). */
  onPick: (ids: string[]) => void;
  onClose: () => void;
  /** Composer: pick a mix, then Done. `selected` empty = everyone. */
  multi?: { selected: string[]; onDone: (ids: string[]) => void };
}) {
  const t = useT();
  const { viewer, relationships } = useViewer();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [sel, setSel] = useState<string[]>(multi?.selected ?? []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setExpanded(false);
    setSel(multi?.selected ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const waiting = useMemo(() => new Set(waitingIds ?? people.filter((p) => status?.(p)?.text === "Waiting for your reply").map((p) => p.id)), [waitingIds, people, status]);
  const view = useMemo(
    () => pickerView({ viewerId: viewer.id, members: people, relationships, waitingIds: waiting, query, expanded, everyoneLabel }),
    [viewer.id, people, relationships, waiting, query, expanded, everyoneLabel],
  );

  const everyoneIds = view.top.find((r) => r.kind === "everyone")?.ids ?? people.map((p) => p.id);
  const isOn = (r: PickerRow): boolean => (r.kind === "everyone" ? sel.length === 0 : r.ids.every((id) => sel.includes(id)) && sel.length >= r.ids.length);
  const choose = (r: PickerRow) => {
    if (!multi) return onPick(r.kind === "everyone" ? everyoneIds : r.ids);
    if (r.kind === "everyone") return setSel([]);
    if (r.kind === "home") return setSel(isOn(r) && sel.length === r.ids.length ? [] : r.ids);
    setSel((cur) => (cur.includes(r.ids[0]) ? cur.filter((id) => id !== r.ids[0]) : [...cur, r.ids[0]]));
  };
  const lit = (r: PickerRow): boolean => {
    if (!multi) return false;
    if (r.kind === "everyone") return sel.length === 0;
    if (r.kind === "home") return sel.length === r.ids.length && r.ids.every((id) => sel.includes(id));
    return sel.includes(r.ids[0]);
  };

  const row = (r: PickerRow) => {
    const on = lit(r);
    const person = r.kind === "person" ? r.member : null;
    const dot = person ? status?.(person)?.dot : undefined;
    return (
      <li key={r.kind === "everyone" ? "everyone" : r.key}>
        <button
          type="button"
          data-picker-row={r.kind}
          aria-pressed={multi ? on : undefined}
          onClick={() => choose(r)}
          className={cn("press flex min-h-[56px] w-full items-center gap-3.5 px-3.5 py-2 text-start", on && "bg-black/[.04]")}
        >
          {r.kind === "person" ? (
            <span className="relative">
              <Avatar src={memberPhoto(r.member)} name={callName(r.member)} size={40} />
              {(r.waiting || dot) && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white" style={{ background: r.waiting ? "#e8402a" : dot }} />}
            </span>
          ) : (
            <span className="flex -space-x-3">
              {(r.kind === "home" ? r.members : people).slice(0, 3).map((p) => (
                <span key={p.id} className="rounded-full ring-2 ring-white">
                  <Avatar src={memberPhoto(p)} name={callName(p)} size={36} />
                </span>
              ))}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-semibold leading-tight">{r.label}</span>
            <span className="block truncate text-footnote text-ink-soft">{r.kind === "person" && r.waiting ? "Waiting for your reply" : r.sub}</span>
          </span>
          {multi ? <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full", on ? "bg-black text-white" : "ring-1 ring-black/20")}>{on && <Icon name="check" size={14} />}</span> : <Icon name="chevron" size={16} className="text-ink-faint rtl:-scale-x-100" />}
        </button>
      </li>
    );
  };

  const list = (rows: PickerRow[]) =>
    rows.length > 0 && (
      <ul className="m-0 list-none divide-y divide-[var(--line)] overflow-hidden rounded-[22px] bg-card p-0 ring-1 ring-black/[.05]">
        {rows.map(row)}
      </ul>
    );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Who is it for?"
      z={60}
      dataUi="people-picker"
      footer={
        multi ? (
          <button type="button" onClick={() => multi.onDone(sel)} className="press h-12 w-full rounded-full bg-black text-body font-semibold text-white">
            Done
          </button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {list(view.top)}
        {view.searchable && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search family"
            aria-label="Search family"
            className="h-11 w-full rounded-full bg-card px-4 text-body text-ink ring-1 ring-black/[.06] placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-black/30"
          />
        )}
        {list(view.rest)}
        {query && view.rest.length === 0 && <p className="m-0 px-2 py-2 text-callout text-ink-soft">No one by that name.</p>}
        {view.hidden > 0 && (
          <button type="button" onClick={() => setExpanded(true)} className="press h-11 w-full rounded-full text-callout font-semibold text-ink-soft">
            Show everyone ({view.hidden} more)
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
