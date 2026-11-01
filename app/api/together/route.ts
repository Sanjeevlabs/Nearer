import { z } from "zod";
import { isGrownUp } from "@/lib/permissions";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { dbGetMember, dbListMembers } from "@/lib/db";
import { docsFor } from "@/lib/request-data";
import { deleteDoc, getDoc, newId, putDoc } from "@/lib/family-docs";
import type { Project } from "@/lib/kinds";
import { canChange } from "@/lib/permissions";
import { TEMPLATES, template } from "@/lib/together-templates";
import { guardWrites } from "@/lib/api-guard";

// Visits & holidays: a visit home or a family holiday, with dates, who's
// going, a shared list and a countdown both homes see. Both are "visit"
// projects; templateId tells them apart ("visit" | "holiday").
// GET  → { templates, projects } (visit-kind only)
// POST → start · edit · people · delete · finish · task-add · task-edit ·
//        task-toggle · task-assign · task-delete

const id = z.string().min(1).max(80);
const Title = z.string().trim().min(2).max(80);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), templateId: z.enum(["visit", "holiday"]), title: Title.optional(), dueAt: z.string().datetime().nullable().default(null), visitorId: id.nullable().default(null), hostIds: z.array(id).max(12).default([]) }),
  z.object({ action: z.literal("edit"), projectId: id, title: Title, dueAt: z.string().datetime().nullable() }),
  z.object({ action: z.literal("people"), projectId: id, visitorId: id.nullable(), hostIds: z.array(id).max(12) }),
  z.object({ action: z.literal("delete"), projectId: id }),
  z.object({ action: z.literal("finish"), projectId: id, done: z.boolean().default(true) }),
  z.object({ action: z.literal("task-add"), projectId: id, text: z.string().trim().min(1).max(140), assignee: id.nullable().default(null) }),
  z.object({ action: z.literal("task-edit"), projectId: id, taskId: id, text: z.string().trim().min(1).max(140) }),
  z.object({ action: z.literal("task-toggle"), projectId: id, taskId: id }),
  z.object({ action: z.literal("task-assign"), projectId: id, taskId: id, assignee: id.nullable() }),
  z.object({ action: z.literal("task-delete"), projectId: id, taskId: id }),
]);

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const projects = (await docsFor(req, auth.familyId, "project")).filter((p) => p.kind === "visit");
  return Response.json({ templates: TEMPLATES, projects });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/together")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-together" }, { status: 400 });
  const body = parsed.data;
  const now = new Date().toISOString();
  const members = await dbListMembers(auth.familyId);
  const known = (x: string | null) => x === null || members.some((m) => m.id === x);
  const me = await dbGetMember(auth.memberId);

  if (body.action === "start") {
    if (!isGrownUp(me)) return Response.json({ error: "grown-ups-only" }, { status: 403 });
    const t = template(body.templateId);
    if (!t) return Response.json({ error: "unknown-template" }, { status: 404 });
    if (!known(body.visitorId) || !body.hostIds.every((h) => known(h))) return Response.json({ error: "unknown-member" }, { status: 400 });
    const project = await putDoc(auth.familyId, "project", {
      id: newId("together"),
      templateId: t.id,
      title: body.title ?? t.title,
      kind: "visit",
      createdBy: auth.memberId,
      dueAt: body.dueAt,
      visitorId: body.visitorId,
      hostIds: Array.from(new Set(body.hostIds.filter((h) => h !== body.visitorId))),
      tasks: t.tasks.map((text) => ({ id: newId("t"), text, assignee: null, done: false })),
      quiz: [],
      status: "active",
      createdAt: now,
    });
    return Response.json({ project }, { status: 201 });
  }

  const project = await getDoc(auth.familyId, "project", body.projectId);
  if (!project) return Response.json({ error: "unknown-project" }, { status: 404 });
  const save = (p: Partial<Project>) => putDoc(auth.familyId, "project", { ...project, ...p });
  const task = "taskId" in body ? project.tasks.find((t) => t.id === body.taskId) : undefined;
  if ("taskId" in body && !task) return Response.json({ error: "unknown-task" }, { status: 404 });
  const tasks = (fn: (t: Project["tasks"][number]) => Project["tasks"][number] | null) => project.tasks.map(fn).filter((t): t is Project["tasks"][number] => t !== null);

  switch (body.action) {
    case "edit":
      return Response.json({ project: await save({ title: body.title, dueAt: body.dueAt }) });
    case "people":
      if (!known(body.visitorId) || !body.hostIds.every((h) => known(h))) return Response.json({ error: "unknown-member" }, { status: 400 });
      return Response.json({ project: await save({ visitorId: body.visitorId, hostIds: Array.from(new Set(body.hostIds.filter((h) => h !== body.visitorId))) }) });
    case "finish":
      return Response.json({ project: await save({ status: body.done ? "done" : "active" }) });
    case "delete":
      if (!canChange(me, project.createdBy)) return Response.json({ error: "not-yours" }, { status: 403 });
      await deleteDoc(auth.familyId, "project", project.id);
      return Response.json({ deleted: project.id });
    case "task-add":
      if (!known(body.assignee)) return Response.json({ error: "unknown-member" }, { status: 400 });
      if (project.tasks.length >= 40) return Response.json({ error: "too-many-tasks" }, { status: 409 });
      return Response.json({ project: await save({ tasks: [...project.tasks, { id: newId("t"), text: body.text, assignee: body.assignee, done: false }] }) }, { status: 201 });
    case "task-edit":
      return Response.json({ project: await save({ tasks: tasks((t) => (t.id === body.taskId ? { ...t, text: body.text } : t)) }) });
    case "task-toggle":
      return Response.json({ project: await save({ tasks: tasks((t) => (t.id === body.taskId ? { ...t, done: !t.done } : t)) }) });
    case "task-assign":
      if (!known(body.assignee)) return Response.json({ error: "unknown-member" }, { status: 400 });
      return Response.json({ project: await save({ tasks: tasks((t) => (t.id === body.taskId ? { ...t, assignee: body.assignee } : t)) }) });
    case "task-delete":
      return Response.json({ project: await save({ tasks: tasks((t) => (t.id === body.taskId ? null : t)) }) });
  }
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
