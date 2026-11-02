"use client";

import Link from "next/link";
import { isGrownUp } from "@/lib/permissions";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlanBadge, countdownWords, daysUntil } from "@/components/together-art";
import { Avatar, Button, EmptyLine, EmptyState, Icon, RoomHeader, SectionTitle } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import type { Project } from "@/lib/kinds";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import type { TogetherTemplate } from "@/lib/together-templates";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { BottomSheet } from "./ui/bottom-sheet";

// Visits (/together/visits) and family holidays (/together/holidays): each
// its own page over the same plans, filtered by template — dates, who's
// going, a shared list, and a countdown both homes see.

const COPY = {
  visit: { title: "Visits", subtitle: "A visit home. Both homes see the countdown.", empty: "No visit planned yet." },
  holiday: { title: "Holidays", subtitle: "Somewhere together. Both homes see the countdown.", empty: "No holiday planned yet." },
} as const;

export function TogetherPlans({ kind }: { kind: TogetherTemplate["id"] }) {
  const { viewer } = useViewer();
  const { data: raw, failed, reload } = useJson<{ templates: TogetherTemplate[]; projects: Project[] }>("/api/together");
  const [open, setOpen] = useState<TogetherTemplate | null>(null);
  const isKind = (id: string | null | undefined) => (kind === "holiday" ? id === "holiday" : id !== "holiday");
  const data = raw ? { templates: raw.templates.filter((t) => t.id === kind), projects: raw.projects.filter((p) => isKind(p.templateId)) } : null;
  const copy = COPY[kind];
  const projects = data?.projects ?? [];
  const active = projects.filter((p) => p.status === "active").sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
  const done = projects.filter((p) => p.status === "done");
  const child = !isGrownUp(viewer);

  const tmpl = data?.templates[0];
  // No tiles to the sibling tabs here: the tab row is the only way sideways.

  return (
    <div>
      <RoomHeader title={copy.title} subtitle={copy.subtitle} />

      {failed && (
        <div className="rounded-card bg-card px-4 py-6 text-center shadow-card">
          <EmptyLine>Couldn&rsquo;t load your plans.</EmptyLine>
          <Button variant="secondary" className="mx-auto !bg-well" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      )}
      {data === null && !failed && <div className="skeleton h-[280px] rounded-card" aria-busy="true" aria-label="Loading plans" />}

      {data && (
        <>
          {active.length > 0 ? (
            <ul className="m-0 grid list-none gap-3 p-0" aria-label="Coming up">
              {active.map((p) => (
                <li key={p.id}>
                  <PlanCard project={p} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              position={kind === "holiday" ? "center 85%" : "center 40%"}
              title={copy.empty}
              line={tmpl?.blurb ?? copy.subtitle}
              action={
                !child && tmpl ? (
                  <Button className="w-full" onClick={() => setOpen(tmpl)}>
                    <Icon name="plus" size={18} />
                    Plan {tmpl.title.charAt(0).toLowerCase() + tmpl.title.slice(1)}
                  </Button>
                ) : undefined
              }
            >
              {tmpl && (
                <ul className="m-0 mt-5 grid list-none gap-2 border-t border-[var(--line)] p-0 pt-4" aria-label="On the list">
                  {tmpl.tasks.map((task) => (
                    <li key={task} className="flex items-center gap-3 text-body text-ink-soft">
                      <span className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-black/15" aria-hidden="true" />
                      {task}
                    </li>
                  ))}
                </ul>
              )}
            </EmptyState>
          )}

          {!child && active.length > 0 && (
            <div className="mt-3 grid gap-3">
              {data.templates.map((t) => (
                <button key={t.id} type="button" onClick={() => setOpen(t)} className="press flex min-h-[56px] w-full items-center gap-3 rounded-card bg-card p-3 pr-4 text-left shadow-card">
                  <PlanBadge holiday={t.id === "holiday"} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold leading-tight">{t.title}</span>
                    <span className="mt-0.5 block text-callout text-ink-soft">Plan it</span>
                  </span>
                  <Icon name="plus" size={20} className="text-ink-soft" />
                </button>
              ))}
            </div>
          )}

          {done.length > 0 && (
            <section aria-label="Done together">
              <SectionTitle>Been together</SectionTitle>
              <ul className="no-scrollbar -mx-4 m-0 flex list-none gap-2 overflow-x-auto px-4 p-0">
                {done.map((p) => (
                  <li key={p.id} className="shrink-0">
                    <Link href={`/together/${p.id}`} className="press flex h-11 items-center gap-2 rounded-full bg-card pl-1.5 pr-4 text-body font-medium text-ink no-underline shadow-card">
                      <PlanBadge holiday={p.templateId === "holiday"} size={32} />
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

        </>
      )}
      {open && <PlanSheet t={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PlanCard({ project }: { project: Project }) {
  const { members } = useViewer();
  const days = daysUntil(project.dueAt);
  const done = project.tasks.filter((t) => t.done).length;
  const total = project.tasks.length;
  const open = project.tasks.filter((t) => !t.done).slice(0, 3);
  const people = [project.visitorId, ...project.hostIds].map((id) => members.find((m) => m.id === id)).filter((m): m is Member => Boolean(m));
  const when = project.dueAt ? new Date(project.dueAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null;
  return (
    <Link href={`/together/${project.id}`} className="press flex h-full flex-col rounded-card bg-card p-4 text-ink no-underline shadow-card">
      <div className="flex items-start justify-between gap-2">
        <span>
          <span data-display className="tnum block text-display font-bold leading-none tracking-[-0.02em]">{days !== null && days > 0 ? days : days === 0 ? "Today" : "–"}</span>
          <span className="mt-1 block text-callout text-ink-soft">
            {days !== null && days > 0 ? `day${days > 1 ? "s" : ""} to go` : days === 0 ? "it's today" : "no date yet"}
            {when ? ` · ${when}` : ""}
          </span>
        </span>
        <PlanBadge holiday={project.templateId === "holiday"} size={44} />
      </div>
      <span className="mt-4 block text-headline font-semibold leading-snug">{project.title}</span>
      {open.length > 0 && (
        <span className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3">
          {open.map((t) => (
            <span key={t.id} className="flex items-center gap-3 text-body text-ink-soft">
              <span className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-black/15" aria-hidden="true" />
              <span className="min-w-0 truncate">{t.text}</span>
            </span>
          ))}
        </span>
      )}
      <span className="mt-4 flex items-center justify-between gap-3">
        <span className="flex -space-x-2">
          {people.slice(0, 4).map((m) => (
            <Avatar key={m.id} src={memberPhoto(m)} name={callName(m)} size={32} ring />
          ))}
        </span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-2.5">
          <span className="h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-well" aria-hidden="true">
            <span className="block h-full rounded-full bg-ink" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
          </span>
          <span className="tnum text-callout text-ink-soft" aria-label={`${done} of ${total} done`}>
            {done}/{total}
          </span>
        </span>
      </span>
    </Link>
  );
}

/** Start a visit or a holiday: dates and who's going. */
function PlanSheet({ t, onClose }: { t: TogetherTemplate; onClose: () => void }) {
  const router = useRouter();
  const { viewer, members } = useViewer();
  const holiday = t.id === "holiday";
  const elders = members.filter((m) => m.role === "elder").map((m) => m.id);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [visitor, setVisitor] = useState(viewer.id);
  const [going, setGoing] = useState<string[]>(holiday ? [viewer.id] : elders.filter((e) => e !== viewer.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const toggle = (id: string) => setGoing((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  const chips = (selected: (id: string) => boolean, onTap: (id: string) => void, label: string) => (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label={label}>
      {members.map((m) => (
        <button key={m.id} type="button" aria-pressed={selected(m.id)} onClick={() => onTap(m.id)} className={cn("press flex h-11 shrink-0 items-center gap-2 rounded-full pl-1 pr-4 text-body font-medium", selected(m.id) ? "bg-ink text-white" : "bg-surface")}>
          <Avatar src={memberPhoto(m)} name={callName(m)} size={34} />
          {m.id === viewer.id ? "Me" : callName(m)}
        </button>
      ))}
    </div>
  );
  return (
    <BottomSheet open onClose={onClose} title={t.title} z={50}>
      <div>
        <div className="flex items-start gap-3">
          <PlanBadge holiday={holiday} />
          <p className="m-0 min-w-0 flex-1 text-body text-ink-soft">{t.blurb}</p>
        </div>
        {holiday && (
          <label className="mt-4 block">
            <span className="mb-1.5 block text-footnote font-medium text-ink-soft">Where to?</span>
            <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 60))} placeholder="Goa in December" className="h-[48px] w-full rounded-full bg-surface px-5 text-body outline-none" />
          </label>
        )}
        <p className="m-0 mb-1.5 mt-4 text-footnote font-medium text-ink-soft">{t.whoLabel}</p>
        {holiday
          ? chips((id) => going.includes(id), toggle, t.whoLabel)
          : chips((id) => id === visitor, (id) => { setVisitor(id); setGoing((g) => g.filter((x) => x !== id)); }, t.whoLabel)}
        {!holiday && (
          <>
            <p className="m-0 mb-1.5 mt-4 text-footnote font-medium text-ink-soft">Staying with</p>
            {chips((id) => going.includes(id), (id) => id !== visitor && toggle(id), "Staying with")}
          </>
        )}
        <label className="mt-4 block">
          <span className="mb-1.5 block text-footnote font-medium text-ink-soft">{holiday ? "Leaving on" : "Arriving on"}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-[48px] w-full rounded-full bg-surface px-5 text-body" />
        </label>
        {error && (
          <p className="m-0 mt-3 text-callout text-[#b42318]" role="alert">
            Couldn&rsquo;t save it. Try again.
          </p>
        )}
        <Button
          className="mt-5 w-full"
          disabled={busy || !date || (holiday && going.length === 0)}
          onClick={async () => {
            setBusy(true);
            setError(false);
            const out = await postJson<{ project: Project }>("/api/together", {
              action: "start",
              templateId: t.id,
              ...(holiday && title.trim().length >= 2 ? { title: title.trim() } : {}),
              dueAt: new Date(`${date}T12:00:00`).toISOString(),
              visitorId: holiday ? null : visitor,
              hostIds: going,
            });
            setBusy(false);
            if (out) router.push(`/together/${out.project.id}`);
            else setError(true);
          }}
        >
          {busy ? "Saving…" : countdownWords(daysUntil(date ? new Date(`${date}T12:00:00`).toISOString() : null)) ? `Start the countdown · ${countdownWords(daysUntil(new Date(`${date}T12:00:00`).toISOString()))}` : "Start the countdown"}
        </Button>
      </div>
    </BottomSheet>
  );
}
