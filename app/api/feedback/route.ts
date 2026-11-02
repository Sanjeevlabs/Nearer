import { z } from "zod";
import { guardWrites } from "@/lib/api-guard";
import { checkRateLimit, requireCan, requireSession } from "@/lib/auth";
import { deleteDoc, getDoc, listDocs, newId, putDoc } from "@/lib/family-docs";
import { normalizeDisplayLang } from "@/lib/i18n";
import { transcribeVoice } from "@/lib/llm";
import { serverLedger, serverStore } from "@/lib/llm-server";
import { allowAuthAttempt } from "@/lib/otp";

// "Tell us by voice": a spoken note to the Nearer team. The recording goes through the same
// transcription as every voice note (lib/llm.ts transcribeVoice); only the WORDS are kept, as a
// `feedback` document in this family's space. The audio is not stored and nothing is sent anywhere else.
// GET: the family's owners and admins read them all; anyone else reads only their own.
const MAX_AUDIO = 8 * 1024 * 1024;
const Fields = z.object({ langHint: z.string().min(2).max(8).default("en"), durationMs: z.coerce.number().int().min(0).max(300_000).default(0) });

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/feedback") || !allowAuthAttempt(`feedback:${auth.memberId}`, 5, 3_600_000)) return Response.json({ error: "rate-limited" }, { status: 429 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid-multipart" }, { status: 400 });
  }
  const audio = form.get("audio");
  const fields = Fields.safeParse({ langHint: form.get("langHint") ?? undefined, durationMs: form.get("durationMs") ?? undefined });
  if (!fields.success) return Response.json({ error: "invalid-feedback" }, { status: 400 });
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "missing-audio" }, { status: 400 });
  if (audio.size > MAX_AUDIO) return Response.json({ error: "audio-too-large" }, { status: 413 });
  const langHint = normalizeDisplayLang(fields.data.langHint);
  const { transcript, unavailable } = await transcribeVoice({ audioBytes: new Uint8Array(await audio.arrayBuffer()), langHint }, { store: serverStore, ledger: serverLedger });
  const text = transcript.transcript.trim().slice(0, 2000);
  // Never store a placeholder as if it were their words: they can simply try again.
  if (unavailable || !text) return Response.json({ error: "transcript-unavailable" }, { status: 503 });
  const note = await putDoc(auth.familyId, "feedback", { id: newId("feedback"), memberId: auth.memberId, text, lang: transcript.language || langHint, durationMs: fields.data.durationMs, at: new Date().toISOString() });
  return Response.json({ feedback: note }, { status: 201 });
}

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const admin = await requireCan(auth, "members.approve", req);
  const all = await listDocs(auth.familyId, "feedback");
  const mine = admin instanceof Response ? all.filter((f) => f.memberId === auth.memberId) : all;
  return Response.json({ feedback: mine.slice(0, 50), seesAll: !(admin instanceof Response) });
}

async function deleteHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const parsed = z.object({ id: z.string().min(1).max(80) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-feedback" }, { status: 400 });
  const note = await getDoc(auth.familyId, "feedback", parsed.data.id);
  if (!note) return Response.json({ error: "unknown-feedback" }, { status: 404 });
  if (note.memberId !== auth.memberId) return Response.json({ error: "not-yours" }, { status: 403 });
  await deleteDoc(auth.familyId, "feedback", note.id);
  return Response.json({ removed: note.id });
}

export const POST = guardWrites(postHandler);
export const GET = guardWrites(getHandler);
export const DELETE = guardWrites(deleteHandler);
