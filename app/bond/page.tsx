"use client";

import { useCallback, useEffect, useState } from "react";
import type { Member, Relationship } from "@/lib/schemas";
import { Avatar, Button, EmptyLine, Icon, RoomHeader } from "@/components/ui/kit";
import { ShareButton } from "@/components/share-sheet";
import { constellation, familyStats } from "@/lib/constellation";
import type { PosterPerson } from "@/lib/poster";
import { treeCard } from "@/lib/share-cards";
import { canShareTree } from "@/lib/share-rules";
import { useJson } from "@/lib/use-json";
import { callName, memberPhoto } from "@/lib/people";
import { cn } from "@/lib/utils";
import { useViewer } from "@/components/viewer";
import { FamilyTree } from "@/components/family-tree";
import { BothSides } from "@/components/sides";
import { InviteSheet } from "@/components/invite-sheet";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { can } from "@/lib/permissions";
import { ZONES, placeFromTz } from "@/lib/zones";
import { Boundary } from "@/components/ui/boundary";
import { BirthYearField } from "@/components/birth-year";
import { birthdayProblem, buildBirthday } from "@/lib/birthday";

const RELATION_WORDS = ["mother", "father", "wife", "husband", "daughter", "son", "sister", "brother"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function GuidedAdd({ onAdded, anchor: preset }: { onAdded: () => void; anchor?: string | null }) {
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
    <section aria-title="Add someone">
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

/** The tree as a poster to share, and the family's faces as a sticker badge. Grown-ups only. */
function TreeShare({ members, relationships }: { members: Member[]; relationships: Relationship[] }) {
  const { viewer } = useViewer();
  const sides = useJson<{ current: string; sides: { familyId: string; name: string }[] }>("/api/sides");
  const name = sides.data?.sides.find((x) => x.familyId === sides.data?.current)?.name ?? "";
  const family = name ? `The ${name} family` : "Our family";
  const people = members.filter((m) => m.status !== "pending");
  return (
    <ShareButton
      label="Share"
      target={() => ({
        title: "Share the family tree",
        note: "A poster of your tree: faces, names and how you\u2019re related. Nothing else from the family.",
        filename: `${(name || "family").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-tree.png`,
        text: family,
        render: () => {
          const c = constellation(people, relationships, viewer.id);
          const stats = familyStats(c, people);
          const map = new Map<string, PosterPerson>(people.map((m) => [m.id, { id: m.id, name: m.id === viewer.id ? "You" : callName(m), label: c.nodes.find((n) => n.id === m.id)?.label ?? "", photo: memberPhoto(m), ring: m.role === "elder" ? "#f2a516" : m.role === "child" ? "#7fb069" : "#2f5684" }]));
          return treeCard(c, map, family, `${stats.people} people \u00b7 ${stats.generations} generations`);
        },
      })}
      sticker={() => {
        // Elders first, then the viewer's generation, then the children: up to 7 faces.
        const order = { elder: 0, adult: 1, child: 2 } as const;
        const faces = [...people].sort((a, b) => order[a.role] - order[b.role]).slice(0, 7).map((m) => ({ name: callName(m), photo: memberPhoto(m) }));
        return { kind: "tree", title: "Family badge", familyName: name || "Our", faces };
      }}
    />
  );
}

export default function BondPage() {
  const { viewer, refreshMembers } = useViewer();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [relationships, setRelationships] = useState<Relationship[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [mRes, rRes] = await Promise.all([fetch("/api/members", { cache: "no-store" }), fetch("/api/relationships", { cache: "no-store" })]);
      if (!mRes.ok || !rRes.ok) throw new Error("bond-fetch-failed");
      const m = (await mRes.json()) as { members: Member[] };
      const r = (await rRes.json()) as { relationships: Relationship[] };
      setMembers(m.members);
      setRelationships(r.relationships);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);


  const mayAdd = can(viewer, "tree.add");
  const mayInvite = can(viewer, "invite.create");
  return (
    <div>
      <RoomHeader
        title="Family tree"
        subtitle="Every generation, both sides"
        action={
          mayInvite ? (
            <button type="button" onClick={() => setInviting(true)} className="press flex h-11 items-center gap-1.5 rounded-full bg-card px-4 text-body font-semibold shadow-card">
              <Icon name="plus" size={16} />
              Invite
            </button>
          ) : undefined
        }
      />
      {failed && <EmptyLine>Couldn&rsquo;t load the family. Try again in a moment.</EmptyLine>}
      {members === null && !failed && <div key="loading" className="skeleton h-[420px] rounded-card" aria-busy="true" aria-label="Loading family" />}
      {members && (
        <>
          <Boundary label="The family tree"><section aria-label="Family tree">
            <FamilyTree
              members={members}
              relationships={relationships ?? []}
              viewerId={viewer.id}
              onAdd={
                mayAdd
                  ? (id) => {
                      setAnchor(id);
                      setAdding(true);
                    }
                  : undefined
              }
            />
          </section></Boundary>
          <div className="mt-4 flex items-center gap-2">
            {mayAdd ? (
              <Button className="flex-1" onClick={() => { setAnchor(null); setAdding(true); }}>
                Add someone
              </Button>
            ) : (
              <p className="m-0 flex-1 text-callout text-ink-soft">Ask a grown-up in the family to add people.</p>
            )}
            {canShareTree(viewer) && <TreeShare members={members} relationships={relationships ?? []} />}
          </div>
          <BothSides />
          {mayAdd && (
            <BottomSheet open={adding} onClose={() => setAdding(false)} title="Add someone">
              <GuidedAdd
                anchor={anchor}
                onAdded={() => {
                  void load();
                  void refreshMembers();
                }}
              />
            </BottomSheet>
          )}
          <InviteSheet open={inviting} onClose={() => setInviting(false)} />
        </>
      )}
    </div>
  );
}
