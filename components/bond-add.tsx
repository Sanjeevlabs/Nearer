"use client";

import { useEffect, useState } from "react";
import { BirthYearField } from "@/components/birth-year";
import { Avatar, Button } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { birthdayProblem, buildBirthday } from "@/lib/birthday";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { ZONES, placeFromTz } from "@/lib/zones";

// The "Add someone" form of the family tree. Loaded only when the sheet is first opened
// (app/bond/page.tsx), so the tree screen does not carry it.

const RELATION_WORDS = ["mother", "father", "wife", "husband", "daughter", "son", "sister", "brother"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function GuidedAdd({ onAdded, anchor: preset }: { onAdded: () => void; anchor?: string | null }) {
  const { viewer, members } = useViewer();
  const [anchorId, setAnchorId] = useState(preset ?? viewer.id);
  useEffect(() => {
    if (preset) setAnchorId(preset);
  }, [preset]);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("mother");
  const [tz, setTz] = useState<string>("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [welcomed, setWelcomed] = useState<string | null>(null);
  const anchor = members.find((m) => m.id === anchorId);

  const submit = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    const problem = birthdayProblem(month, day, year);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/relationships", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberId: anchorId,
          newMemberName: clean,
          relation,
          tz: tz || anchor?.tz || undefined,
          birthday: buildBirthday(month, day, year) || undefined,
        }),
      });
      if (!res.ok) throw new Error(res.status === 409 ? "duplicate" : res.status === 401 ? "signed-out" : "add-failed");
      const data = (await res.json()) as { member: Member };
      // "Welcome to the family" moment: a Bond card lands in Memory Lane.
      await fetch("/api/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "photo",
          caption: `Welcome to the family, ${clean}`,
          lang: "en",
          takenAt: new Date().toISOString(),
          source: "agent",
          mediaRef: null,
          peaks: [],
          palette: [],
        }),
      }).catch(() => undefined);
      setWelcomed(data.member.displayName);
      setName("");
      setMonth("");
      setDay("");
      setYear("");
      onAdded();
    } catch (e) {
      const key = e instanceof Error ? e.message : "";
      setError(key === "duplicate" ? `${clean} is already in the family.` : key === "signed-out" ? "Your session ended. Sign in again to add family." : "Couldn't add them. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Add someone">
      <h2 className="m-0 mb-1 text-title">Add someone</h2>
      <p className="m-0 mb-4 text-body text-ink-soft">Tell Nearer how they&rsquo;re related to someone already here.</p>
      <p className="m-0 mb-4 rounded-[16px] bg-surface px-4 py-3 text-callout text-ink-soft">
        <span className="font-semibold text-ink">Uncles, aunts and cousins:</span> add them through a parent. &ldquo;Chachu is <em>Papa&rsquo;s brother</em>&rdquo;, &ldquo;Mausi is <em>Maa&rsquo;s sister</em>&rdquo;, then their children as their son or daughter. Nearer works out &ldquo;your uncle&rdquo; or &ldquo;your cousin&rdquo; for everyone.
      </p>
      {welcomed && (
        <div className="bond-bloom mb-4 rounded-[22px] bg-surface px-4 py-3" role="status">
          <p className="m-0 text-headline font-semibold">Welcome to the family, {welcomed}</p>
          <p className="m-0 text-callout text-ink-soft">A welcome card is waiting in Memory Lane.</p>
        </div>
      )}
      <label className="block">
        <span className="mb-1.5 block text-footnote font-medium text-ink-soft">Their name</span>
        <input
          type="text"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="Meera"
          className="h-12 w-full rounded-full bg-surface px-5 text-body outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-black/15"
        />
      </label>
      <p className="m-0 mb-1.5 mt-4 text-footnote font-medium text-ink-soft">They are the</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Relation">
        {RELATION_WORDS.map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={relation === w}
            onClick={() => setRelation(w)}
            className={cn("press h-10 rounded-full px-4 text-body font-medium", relation === w ? "bg-accent text-accent-ink" : "bg-surface")}
          >
            {w}
          </button>
        ))}
      </div>
      <p className="m-0 mb-1.5 mt-4 text-footnote font-medium text-ink-soft">of</p>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Related to">
        {members.map((mm) => (
          <button
            key={mm.id}
            type="button"
            role="radio"
            aria-checked={anchorId === mm.id}
            onClick={() => setAnchorId(mm.id)}
            className={cn("press flex h-11 shrink-0 items-center gap-2 rounded-full pl-1 pr-4 text-body font-medium", anchorId === mm.id ? "bg-accent text-accent-ink" : "bg-surface")}
          >
            <Avatar src={memberPhoto(mm)} name={callName(mm)} size={34} />
            {mm.id === viewer.id ? "You" : callName(mm)}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-[1.4fr_1fr_1fr] gap-2">
        <label className="col-span-3 block">
          <span className="mb-1.5 block text-footnote font-medium text-ink-soft">Where they live</span>
          <select value={tz || anchor?.tz || ""} onChange={(e) => setTz(e.target.value)} className="h-12 w-full appearance-none rounded-full bg-surface px-5 text-body outline-none focus:ring-2 focus:ring-black/15">
            {Array.from(new Set([anchor?.tz, ...ZONES.map((z) => z.tz)].filter((z): z is string => Boolean(z) && z !== "UTC"))).map((z) => (
              <option key={z} value={z}>
                {placeFromTz(z)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-footnote font-medium text-ink-soft">Birthday (optional)</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Birthday month" className="h-12 w-full appearance-none rounded-full bg-surface px-4 text-body outline-none">
            <option value="">Month</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1).padStart(2, "0")}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-footnote font-medium text-transparent">Day</span>
          <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Birthday day" className="h-12 w-full appearance-none rounded-full bg-surface px-4 text-body outline-none">
            <option value="">Day</option>
            {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
              <option key={d} value={d}>
                {Number(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-footnote font-medium text-transparent">Year</span>
          <BirthYearField value={year} onChange={setYear} className="!bg-surface !px-4" />
        </label>
      </div>
      <p className="m-0 mt-2 text-footnote text-ink-soft">The year is optional. With it, Nearer can show their age.</p>
      {error && (
        <p className="m-0 mt-3 text-callout text-[#b42318]" role="alert">
          {error}
        </p>
      )}
      <Button className="mt-5 w-full" disabled={busy || !name.trim()} onClick={() => void submit()}>
        {busy ? "Adding…" : name.trim() && anchor ? `Add ${name.trim()} as ${anchor.id === viewer.id ? "your" : `${callName(anchor)}'s`} ${relation}` : "Add to the family"}
      </Button>
      <style>{`.bond-bloom{animation:bond-grow .32s cubic-bezier(.32,.72,0,1)}@keyframes bond-grow{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
    </section>
  );
}
