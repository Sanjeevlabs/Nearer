"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PlanBadge, daysUntil } from "@/components/together-art";
import { ActionMenu, Avatar, Button, EmptyLine, Icon, RoomHeader, SectionTitle } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import type { Project } from "@/lib/kinds";
import { canChange } from "@/lib/permissions";
import { callName, memberPhoto } from "@/lib/people";
import type { TogetherTemplate } from "@/lib/together-templates";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { viewer, members } = useViewer();
  const { data, failed, reload } = useJson<{ templates: TogetherTemplate[]; projects: Project[] }>("/api/together");
  const [text, setText] = useState("");
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editingPlan, setEditingPlan] = useState(false);
  const p = data?.projects.find((x) => x.id === id);

  if (failed && !data) return <div><RoomHeader title="Plan" /><EmptyLine>Couldn&rsquo;t load this plan. Try again in a moment.</EmptyLine></div>;
  if (!data) return <div className="skeleton mt-16 h-[420px] rounded-card" aria-busy="true" />;
  if (!p) {
    return (
      <div>
        <RoomHeader title="Plan" />
        <EmptyLine>This plan isn&rsquo;t here anymore.</EmptyLine>
      </div>
    );
  }
  const holiday = p.templateId === "holiday";
  const act = async (body: Record<string, unknown>) => {
    await postJson("/api/together", { projectId: p.id, ...body });
    await reload();
  };
  const days = daysUntil(p.dueAt);
  const visitor = members.find((m) => m.id === p.visitorId);
  const done = p.tasks.filter((x) => x.done).length;
  const people = members.filter((m) => m.access !== "child" || m.id === viewer.id);
  const hosts = p.hostIds.map((h) => members.find((m) => m.id === h)).filter((m): m is (typeof members)[number] => Boolean(m));

  return (
    <div>
      <RoomHeader
        title=""
        action={
          <ActionMenu
            label="Plan options"
            actions={[
              { label: "Change dates or name", onSelect: () => setEditingPlan(true) },
              { label: p.status === "done" ? "Not done yet" : "Mark as done", onSelect: () => act({ action: "finish", done: p.status !== "done" }) },
              ...(canChange(viewer, p.createdBy) ? [{ label: "Delete", danger: true, confirm: "Delete this plan and its list?", onSelect: async () => { await postJson("/api/together", { action: "delete", projectId: p.id }); router.replace(p.templateId === "holiday" ? "/together/holidays" : "/together/visits"); } }] : []),
            ]}
          />
        }
      />
      <div className="flex items-center gap-3">
        <PlanBadge holiday={holiday} />
        <div className="min-w-0">
          <p className="m-0 text-caption font-semibold uppercase tracking-[0.06em] text-ink-soft">
            {holiday ? "Holiday" : "Visit home"}
            {p.status === "done" ? " · done" : ""}
          </p>
          <h1 data-display className="m-0 text-display leading-tight">{p.title}</h1>
        </div>
      </div>

      <div className="mt-4 rounded-hero bg-surface p-4">
        <p data-display className="tnum m-0 text-display font-bold leading-none">{days === null ? "–" : days > 0 ? days : days === 0 ? "Today" : "✓"}</p>
        <p className="m-0 mt-1 text-body font-medium">
          {days === null
            ? "Pick a date to start the countdown"
            : days > 0
              ? holiday
                ? `day${days > 1 ? "s" : ""} to go`
                : `day${days > 1 ? "s" : ""} till ${visitor?.id === viewer.id ? "you're" : `${callName(visitor)} is`} home`
              : days === 0
                ? holiday
                  ? "It's today"
                  : `${callName(visitor)} arrives today`
                : "Been together"}
        </p>
        {p.dueAt && <p className="m-0 mt-1 text-footnote text-ink-soft">{new Date(p.dueAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · both homes see this</p>}
        <div className="no-scrollbar -mx-4 mt-3 flex items-center gap-1.5 overflow-x-auto px-4">
          {[...(visitor ? [visitor] : []), ...hosts].map((m) => (
            <span key={m.id} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-surface pl-0.5 pr-3 text-footnote font-medium">
              <Avatar src={memberPhoto(m)} name={callName(m)} size={32} />
              {m.id === viewer.id ? "Me" : callName(m)}
            </span>
          ))}
        </div>
      </div>
      {editingPlan && <EditPlan project={p} onClose={() => setEditingPlan(false)} onSave={async (body) => { await act(body); setEditingPlan(false); }} />}

      <SectionTitle>
        To do <span className="text-body font-medium text-ink-faint">· {done}/{p.tasks.length}</span>
      </SectionTitle>
      <ul className="m-0 list-none divide-y divide-[var(--line)] rounded-card bg-surface p-0 px-3">
        {p.tasks.map((task) => {
          const who = members.find((m) => m.id === task.assignee);
          return (
            <li key={task.id} className="py-2">
              <div className="flex items-center gap-2.5">
                <button type="button" aria-pressed={task.done} aria-label={`${task.done ? "Not done" : "Done"}: ${task.text}`} onClick={() => act({ action: "task-toggle", taskId: task.id })} className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border-2", task.done ? "border-black bg-accent text-accent-ink" : "border-black/25")}>
                  {task.done && <Icon name="check" size={14} strokeWidth={3} />}
                </button>
                {editing === task.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, 140))}
                    onBlur={async () => { if (draft.trim() && draft !== task.text) await act({ action: "task-edit", taskId: task.id, text: draft.trim() }); setEditing(null); }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    className="h-10 min-w-0 flex-1 rounded-[12px] bg-surface px-3 text-body outline-none"
                    aria-label="Task"
                  />
                ) : (
                  <span className={cn("min-w-0 flex-1 text-body", task.done && "text-ink-faint line-through decoration-black/20")}>{task.text}</span>
                )}
                <button type="button" onClick={() => setAssignFor(assignFor === task.id ? null : task.id)} aria-label={who ? `Assigned to ${callName(who)}. Change` : "Assign"} className="press shrink-0">
                  {who ? <Avatar src={memberPhoto(who)} name={callName(who)} size={30} /> : <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-dashed border-black/25 text-ink-faint"><Icon name="plus" size={14} /></span>}
                </button>
                <ActionMenu
                  label="Task options"
                  actions={[
                    { label: "Edit", onSelect: () => { setEditing(task.id); setDraft(task.text); } },
                    { label: "Delete", danger: true, confirm: "Delete this task?", onSelect: () => act({ action: "task-delete", taskId: task.id }) },
                  ]}
                />
              </div>
              {assignFor === task.id && (
                <div className="no-scrollbar -mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3 pb-1">
                  {people.map((m) => (
                    <button key={m.id} type="button" aria-pressed={task.assignee === m.id} onClick={async () => { await act({ action: "task-assign", taskId: task.id, assignee: task.assignee === m.id ? null : m.id }); setAssignFor(null); }} className={cn("press flex h-10 shrink-0 items-center gap-1.5 rounded-full pl-1 pr-3 text-callout font-medium", task.assignee === m.id ? "bg-accent text-accent-ink" : "bg-surface")}>
                      <Avatar src={memberPhoto(m)} name={callName(m)} size={30} />
                      {m.id === viewer.id ? "Me" : callName(m)}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {p.tasks.length === 0 && <li className="py-4 text-center text-callout text-ink-soft">Nothing on the list yet.</li>}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          await act({ action: "task-add", text: text.trim(), assignee: null });
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value.slice(0, 140))} placeholder="Add to the list" className="h-[48px] min-w-0 flex-1 rounded-full bg-surface px-5 text-body outline-none focus:ring-2 focus:ring-black/15" aria-label="New task" />
        <Button type="submit" className="h-[48px] px-4" disabled={!text.trim()}>
          Add
        </Button>
      </form>

    </div>
  );
}

/** Rename the plan or move its date. */
function EditPlan({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [title, setTitle] = useState(project.title);
  const [date, setDate] = useState(project.dueAt ? project.dueAt.slice(0, 10) : "");
  return (
    <div className="mt-3 space-y-2 rounded-card bg-surface p-3">
      <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} aria-label="Plan name" className="h-11 w-full rounded-full bg-surface px-4 text-body outline-none" />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className="h-11 w-full rounded-full bg-surface px-4 text-body" />
      <div className="flex gap-2">
        <Button variant="quiet" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button className="flex-1" disabled={title.trim().length < 2} onClick={() => void onSave({ action: "edit", title: title.trim(), dueAt: date ? new Date(`${date}T12:00:00`).toISOString() : null })}>
          Save
        </Button>
      </div>
    </div>
  );
}
