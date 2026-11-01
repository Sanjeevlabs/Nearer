"use client";

import { useState } from "react";
import { guardiansOf, isKid, shortDate } from "@/lib/kids";
import type { HeightMark } from "@/lib/kinds";
import type { Member } from "@/lib/schemas";
import { callName } from "@/lib/people";
import { postJson, useJson } from "@/lib/use-json";
import { Doorframe } from "./doorframe";
import { Icon } from "./ui/kit";
import { useViewer } from "./viewer";

// A child's doorframe on their person page. A parent or grandparent adds a mark with a
// small sheet; the child sees the same marks on their own wall (kid-home). A mark is a
// number and a date: no advice, no comparison, nothing about health.

const field = "h-[52px] w-full appearance-none rounded-full bg-white px-5 text-[16px] outline-none focus:ring-2 focus:ring-marigold";

function AddMark({ child, onClose, onSaved }: { child: Member; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [cm, setCm] = useState("");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(cm.replace(",", "."));
  const ok = Number.isFinite(n) && n >= 30 && n <= 220;

  const save = async () => {
    setBusy(true);
    setError(null);
    // Today keeps its real time; an earlier day is noon that day.
    const at = day === today ? new Date().toISOString() : new Date(`${day}T12:00:00Z`).toISOString();
    const out = await postJson("/api/height", { memberId: child.id, cm: n, note: note.trim(), at });
    setBusy(false);
    if (!out) return setError("Couldn't save the mark. Try again.");
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={`Add a mark for ${callName(child)}`} data-ui="height-sheet">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[480px] rounded-t-[32px] bg-paper px-5 pt-3 shadow-frost" style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }}>
        <span className="mx-auto mb-3 block h-1.5 w-10 rounded-full bg-black/15" aria-hidden="true" />
        <h2 className="m-0 text-[22px]">A mark for {callName(child)}</h2>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">How tall, in centimetres</span>
            <input className={field} inputMode="decimal" placeholder="e.g. 124.5" value={cm} onChange={(e) => setCm(e.target.value)} autoFocus />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">The day</span>
            <input className={field} type="date" max={today} value={day} onChange={(e) => setDay(e.target.value || today)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">A few words (optional)</span>
            <input className={field} maxLength={60} placeholder="Standing very straight" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {error && (
          <p role="alert" className="m-0 mt-3 text-[14px] text-[#b3261e]">
            {error}
          </p>
        )}
        <button type="button" disabled={!ok || busy} onClick={() => void save()} className="press mt-4 h-[52px] w-full rounded-full bg-black text-[16px] font-semibold text-white disabled:opacity-40">
          {busy ? "Saving…" : "Add the mark"}
        </button>
      </div>
    </div>
  );
}

export function HeightMarks({ person }: { person: Member }) {
  const { viewer, relationships } = useViewer();
  const marks = useJson<{ marks: HeightMark[] }>(isKid(person) ? `/api/height?memberId=${encodeURIComponent(person.id)}` : null);
  const [adding, setAdding] = useState(false);
  if (!isKid(person)) return null;
  const mayMark = !isKid(viewer) && guardiansOf(person.id, relationships).includes(viewer.id);
  const list = marks.data?.marks ?? [];
  const mine = list.filter((m) => m.byMemberId === viewer.id);
  if (!mayMark && list.length === 0) return null;

  const remove = async (id: string) => {
    await postJson(`/api/height?id=${encodeURIComponent(id)}`, undefined, "DELETE");
    await marks.reload();
  };

  return (
    <section data-ui="person-height" aria-label="On the doorframe" className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-[20px]">On the doorframe</h2>
        {mayMark && (
          <button type="button" onClick={() => setAdding(true)} className="press h-10 rounded-full bg-surface px-4 text-[14px] font-semibold">
            Add a mark
          </button>
        )}
      </div>
      {list.length > 0 ? (
        <div className="mt-3 rounded-[26px] bg-surface px-4 py-5">
          <Doorframe marks={list} />
        </div>
      ) : (
        <p className="m-0 mt-2 text-[14.5px] text-ink-soft">No marks yet.</p>
      )}
      {mine.length > 0 && (
        <ul className="m-0 mt-3 list-none divide-y divide-[var(--line)] p-0">
          {[...mine].reverse().map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-1.5 text-[14.5px]">
              <span>
                {m.cm} cm · {shortDate(m.at)}
              </span>
              <button type="button" onClick={() => void remove(m.id)} aria-label={`Remove the ${shortDate(m.at)} mark`} className="press grid h-11 w-11 place-items-center rounded-full text-ink-soft">
                <Icon name="trash" size={17} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <AddMark
          child={person}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void marks.reload();
          }}
        />
      )}
    </section>
  );
}
