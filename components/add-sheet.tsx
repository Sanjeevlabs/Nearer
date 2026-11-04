"use client";

import { LISTEN_WORDS, type ListenWay } from "@/lib/listen";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addressTo, householdName, households } from "@/lib/households";
import { ASK_STARTERS } from "@/lib/i18n";
import { blobToWav16k, extractVideoFrames, processImage, processVideo, processVoiceBlob, type ProcessedUpload } from "@/lib/media-client";
import { getSessionMedia } from "@/lib/media-session";
import { uploadQueue, type Outcome } from "@/lib/upload-queue";
import { callName, formatDuration, memberPhoto } from "@/lib/people";
import { isKid } from "@/lib/kids";
import type { TranscriptSegment } from "@/lib/schemas";
import { CARD_NOTE_MAX, CARD_PLACE_MAX } from "@/lib/card-limits";
import { cn } from "@/lib/utils";
import { hourIn, placeFromTz } from "@/lib/zones";
import { keepRender } from "@/lib/muse-canvas";
import { RestoreOffer, type Restored } from "./muse-restore";
import { useShell } from "./shell";
import { Avatar, Button, Icon, LiveDot, PlayButton } from "./ui/kit";
import { PeoplePicker } from "./people-picker";
import { BottomSheet } from "./ui/bottom-sheet";
import { useViewer } from "./viewer";
import { Teleprompter } from "./prompt-text";
import { useJson } from "@/lib/use-json";
import { useFamilyCards } from "@/lib/use-family";
import { notJoined } from "@/lib/sent";

export type AddTab = "photos" | "voice" | "video" | "ask";

/**
 * What a recording is *for*. One recorder serves every voice-first path:
 * birthday wishes, teaching a recipe, answering the weekly question, and
 * asking the family for help. Muse turns the words into the right thing.
 */
export type ReplyContribution =
  | { kind: "wish" | "blessing"; runId: string }
  | { kind: "recipe"; title?: string; questionId?: string }
  | { kind: "answer"; questionId: string; prompt: string }
  | { kind: "need"; forMemberId?: string }
  | { kind: "story"; questionId?: string; prompt?: string }
  | { kind: "card_reply"; cardId: string }
  | { kind: "today"; taskId: string; prompt: string }
  /** A child asks by voice (an ask for a grandparent or parent; lib/kids.ts). */
  | { kind: "kid_ask"; topic?: "question" | "story"; toMemberId?: string }
  /** A grown-up answers a child's ask by voice; it also lands in Stories. */
  | { kind: "kid_answer"; askId: string; prompt?: string }
  /** A bedtime story for one child. */
  | { kind: "bedtime"; forMemberId: string }
  /** A grown-up photographs a child's drawing for the fridge; the sheet asks whose it is. */
  | { kind: "fridge"; forMemberId?: string };

const PURPOSE: Record<Exclude<ReplyContribution["kind"], "wish" | "blessing">, { title: string; hint: string; cta: string }> = {
  card_reply: { title: "Reply by voice", hint: "Send a voice memory back.", cta: "Send my reply" },
  fridge: { title: "Add to the fridge", hint: "A drawing, a school photo, a first attempt. It goes up with their name and yours.", cta: "Put it on the fridge" },
  kid_ask: { title: "Ask a question", hint: "Say it out loud. They will hear it and answer in their own voice.", cta: "Send my question" },
  kid_answer: { title: "Your answer", hint: "Answer the way you would at the table. It is kept in Stories too.", cta: "Send my answer" },
  bedtime: { title: "A story for tonight", hint: "A few minutes, a quiet voice. It waits on their screen for tonight.", cta: "Send the story" },
  story: {
    title: "Tell a story",
    hint: "Tell it the way you would at bedtime. Take your time; the children will hear your voice, with the words along.",
    cta: "Add to Stories",
  },
  recipe: {
    title: "Teach a recipe",
    hint: "Talk while you cook, the way you'd teach at the stove. Say the amounts your way. It becomes a recipe card for the family.",
    cta: "Save to the Kitchen",
  },
  today: { title: "Today, for both homes", hint: "Say it the way you would across the table. When you send yours, you'll hear theirs.", cta: "Send my answer" },
  answer: { title: "Your answer", hint: "Take your time. Your voice is kept for the family, word for word.", cta: "Keep my answer" },
  need: {
    title: "Ask for help",
    hint: "Say what you need: groceries, a ride, something to fix. Your family and your local helpers will see it.",
    cta: "Ask the family",
  },
};

export function purposeTitle(c: ReplyContribution | null): string | null {
  if (!c || c.kind === "wish" || c.kind === "blessing") return null;
  return PURPOSE[c.kind].title;
}

/* ------------------------------------------------------------------ data */

// Card upload carries the real bytes: `media` for the photo/video plus key
// frames for video grounding. The server captions from these bytes only.
async function postMoment(upload: ProcessedUpload, file: File | Blob, caption: string, lang: string, frames: Blob[] = [], extra: { place?: string; note?: string; forMemberId?: string; captionFinal?: boolean; addressedTo?: string | null } = {}): Promise<Outcome> {
  const fields: Record<string, string> = {
    type: upload.kind === "video" ? "video" : "photo",
    caption,
    lang,
    takenAt: upload.takenAt,
    takenAtSource: upload.takenAtSource,
    mediaRef: upload.mediaRef,
    source: upload.source,
    peaks: JSON.stringify(upload.peaks),
    palette: JSON.stringify(upload.palette),
    taggedNames: JSON.stringify([]),
  };
  if (extra.place) fields.place = extra.place.slice(0, CARD_PLACE_MAX);
  if (extra.note) fields.note = extra.note.slice(0, CARD_NOTE_MAX);
  if (extra.forMemberId) fields.forMemberId = extra.forMemberId;
  if (extra.addressedTo) fields.addressedTo = extra.addressedTo;
  if (extra.captionFinal) fields.captionFinal = "1";
  const files = [{ field: "media", name: "media", blob: file as Blob }, ...frames.slice(0, 3).map((blob) => ({ field: "frames", name: "frame.jpg", blob }))];
  // Saved on the device first; the queue sends it and keeps retrying if the network drops.
  return uploadQueue().enqueue({
    id: crypto.randomUUID(),
    fields,
    files,
    upload: upload.mediaRef.startsWith("storage:") ? undefined : { blob: file as Blob, filename: upload.kind === "video" ? "video.mp4" : "photo.jpg", mime: (file as Blob).type || "application/octet-stream" },
  });
}

async function postVoice(input: {
  upload: ProcessedUpload;
  caption: string;
  transcript: string;
  transcriptLang: string;
  segments: TranscriptSegment[];
  addressedTo: string | null;
  replyToCardId?: string;
  /** "How to listen": only with addressees, never required. */
  listen?: ListenWay | null;
  /** Posted after a retried send lands; a first-try success leaves these to the caller. */
  after?: (cardId: string) => { url: string; body: unknown }[];
}): Promise<{ ok: boolean; id: string | null; queued: boolean }> {
  const id = crypto.randomUUID();
  const voiceBlob = input.upload.mediaRef.startsWith("storage:") ? null : (getSessionMedia(input.upload.mediaRef)?.blob ?? null);
  const outcome = await uploadQueue().enqueue({
    id,
    json: {
      type: "audio",
      caption: input.caption.slice(0, 280),
      lang: input.transcriptLang,
      takenAt: input.upload.takenAt,
      source: input.upload.source,
      mediaRef: input.upload.mediaRef,
      peaks: input.upload.peaks,
      palette: input.upload.palette,
      transcript: input.transcript.slice(0, 2000),
      transcriptLang: input.transcriptLang,
      segments: input.segments.slice(0, 64),
      addressedTo: input.addressedTo,
      replyToCardId: input.replyToCardId,
      ...(input.listen && input.addressedTo ? { listen: input.listen } : {}),
    },
    upload: voiceBlob ? { blob: voiceBlob, filename: "voice.webm", mime: voiceBlob.type || "audio/webm" } : undefined,
    after: input.after?.(id),
  });
  return { ok: outcome !== "dropped", id: outcome === "dropped" ? null : id, queued: outcome === "queued" };
}

const CONSENT_KEY = "aangan:voice-consent";

/* --------------------------------------------------------- live mic level */
function useMicLevels(stream: MediaStream | null, bars = 40): number[] {
  const [levels, setLevels] = useState<number[]>(() => new Array(bars).fill(0.08));
  useEffect(() => {
    if (!stream) return;
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 70) return;
      last = t;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let k = 0; k < data.length; k++) peak = Math.max(peak, Math.abs(data[k] - 128) / 128);
      setLevels((prev) => [...prev.slice(1), Math.min(1, 0.08 + peak * 1.6)]);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close().catch(() => undefined);
    };
  }, [stream]);
  return levels;
}

/* ------------------------------------------------------------- recipients */
/** Who a voice note is for: the same picker as the dock's mic. Here it picks any mix; none = everyone. */
function Recipients({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { viewer, members, relationships } = useViewer();
  const [open, setOpen] = useState(false);
  const { data: wait } = useJson<{ items: { fromId?: string }[] }>("/api/waiting");
  const waitingIds = useMemo(() => (wait?.items ?? []).flatMap((i) => (i.fromId ? [i.fromId] : [])), [wait]);
  const others = useMemo(() => members.filter((mm) => mm.id !== viewer.id && mm.status !== "pending"), [members, viewer.id]);
  const chosen = value.length ? others.filter((mm) => value.includes(mm.id)) : others;
  const home = households(members, relationships).find((h) => value.length > 1 && h.members.length === value.length && h.members.every((mm) => value.includes(mm.id)));
  const label = value.length === 0 ? "Everyone" : home ? householdName(home, (mm) => callName(mm)) : chosen.length <= 2 ? chosen.map((mm) => callName(mm)).join(" & ") : `${chosen.slice(0, 2).map((mm) => callName(mm)).join(", ")} +${chosen.length - 2}`;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="press flex min-h-[48px] w-full items-center gap-3 rounded-full bg-surface py-1 pl-1.5 pr-4 text-start">
        <span className="sr-only">Who is this for?</span>
        <span className="flex -space-x-2" aria-hidden="true">
          {chosen.slice(0, 3).map((mm) => (
            <span key={mm.id} className="rounded-full ring-2 ring-white">
              <Avatar src={memberPhoto(mm)} name={callName(mm)} size={34} />
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-body font-semibold">{label}</span>
        <span className="text-callout font-medium text-ink-soft">Change</span>
      </button>
      <PeoplePicker
        open={open}
        people={others}
        waitingIds={waitingIds}
        multi={{ selected: value, onDone: (ids) => { onChange(ids.length === others.length ? [] : ids); setOpen(false); } }}
        onPick={() => undefined}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ voice */
interface VoiceReady {
  upload: ProcessedUpload;
  url: string;
  transcript: string;
  transcriptLang: string;
  segments: TranscriptSegment[];
  unavailable: boolean;
}

function VoiceComposer({ addressee, contribution, onDone }: { addressee: string[] | null; contribution: ReplyContribution | null; onDone: () => void }) {
  const router = useRouter();
  const { refreshKey } = useShell();
  const { viewer, members, relationships, displayLang } = useViewer();
  const { cards: familyCards } = useFamilyCards(refreshKey);
  const purpose = contribution && contribution.kind !== "wish" && contribution.kind !== "blessing" ? PURPOSE[contribution.kind] : null;
  const [to, setTo] = useState<string[]>(addressee ?? []);
  const [listen, setListen] = useState<ListenWay | null>(null);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"idle" | "recording" | "working" | "ready">("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState<VoiceReady | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ideas, setIdeas] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const levels = useMicLevels(stream);
  // Morning letter (SPEC §30.4): when it's night where they are, the note can
  // wait in the envelope and arrive with their morning (7:30 AM their time).
  const theirTz = members.find((m) => m.id === to[0])?.tz ?? null;
  const theirHour = theirTz ? hourIn(theirTz, new Date()) : 12;
  const nightThere = Boolean(theirTz && !contribution && (theirHour >= 21.5 || theirHour < 6));
  const [letter, setLetter] = useState(true);
  const morningAt = () => new Date(Date.now() + (((7.5 - theirHour + 24) % 24) * 3_600_000)).toISOString();
  // "Maa & Papa" when a whole home is chosen, otherwise the people's names.
  const toLabel = (() => {
    if (to.length === 0) return "";
    const home = households(members, relationships).find((h) => h.members.length === to.length && h.members.every((m) => to.includes(m.id)));
    if (home) return householdName(home, (m) => callName(m));
    const names = to.map((id) => callName(members.find((m) => m.id === id)));
    return names.length <= 2 ? names.join(" & ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  })();

  // Chosen people who have not joined yet: the note is kept for them, and the sender is told so.
  const notYet = useMemo(() => {
    const active = new Set((familyCards ?? []).flatMap((c) => (c.authorId ? [c.authorId] : [])));
    return to.flatMap((id) => {
      const m = members.find((x) => x.id === id);
      return m && notJoined(m, active) ? [callName(m)] : [];
    });
  }, [to, members, familyCards]);
  const notYetLine = notYet.length ? `${notYet.join(" and ")} ${notYet.length > 1 ? "haven't" : "hasn't"} joined yet. They'll get it when they do. You can find it under Sent.` : null;

  useEffect(() => {
    try {
      setConsent(localStorage.getItem(CONSENT_KEY) === "1");
    } catch {
      setConsent(false);
    }
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  useEffect(
    () => () => {
      stream?.getTracks().forEach((tr) => tr.stop());
    },
    [stream],
  );

  const finish = useCallback(
    async (blob: Blob) => {
      setPhase("working");
      try {
        const upload = await processVoiceBlob(blob, { fromToday: true, fromGlassesToggle: false });
        const wav = await blobToWav16k(blob);
        const form = new FormData();
        form.append("audio", new Blob([wav.bytes as unknown as BlobPart], { type: "audio/wav" }), "voice.wav");
        form.append("langHint", viewer.displayLang ?? displayLang);
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        if (!res.ok) throw new Error("transcribe-failed");
        const data = (await res.json()) as {
          transcript: { transcript: string; language: string; summary: string; segments: TranscriptSegment[] };
          unavailable?: boolean;
        };
        setReady({
          upload,
          url: upload.previewUrl ?? "",
          transcript: data.transcript.transcript,
          transcriptLang: data.transcript.language,
          segments: data.transcript.segments ?? [],
          unavailable: data.unavailable === true,
        });
        setPhase("ready");
      } catch {
        setError("Couldn't process that recording. Try again.");
        setPhase("idle");
      }
    },
    [viewer.displayLang, displayLang],
  );

  const start = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm", "audio/mp4"].find((mt) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mt));
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => void finish(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      recorderRef.current = rec;
      setStream(s);
      setSeconds(0);
      rec.start();
      setPhase("recording");
    } catch {
      setError("Nearer needs your microphone. Allow it in your browser settings, then try again.");
    }
  };

  const stop = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    stream?.getTracks().forEach((tr) => tr.stop());
    setStream(null);
  };

  const discard = () => {
    audioRef.current?.pause();
    if (ready?.url) URL.revokeObjectURL(ready.url);
    setReady(null);
    setPreviewPlaying(false);
    setPhase("idle");
  };

  const send = async () => {
    if (!ready) return;
    setNotice("Saved, sending…");
    setPhase("working");
    // If the network drops, the queue keeps the recording and posts these once it lands.
    const after = (cardId: string) => {
      const steps: { url: string; body: unknown }[] = [];
      if (nightThere && letter) steps.push({ url: "/api/letters", body: { cardId, deliverAt: morningAt() } });
      if (contribution?.kind === "wish" || contribution?.kind === "blessing") steps.push({ url: "/api/wishes", body: { ritualRunId: contribution.runId, cardId, memberId: viewer.id, kind: contribution.kind } });
      else if (contribution?.kind === "recipe") steps.push({ url: "/api/kitchen", body: { action: "teach", cardId, title: contribution.title, questionId: contribution.questionId } });
      else if (contribution?.kind === "story") steps.push({ url: "/api/stories", body: { action: "tell", cardId, questionId: contribution.questionId } });
      else if (contribution?.kind === "today") steps.push({ url: "/api/today", body: { action: "answer", taskId: contribution.taskId, cardId } });
      else if (contribution?.kind === "answer") steps.push({ url: "/api/keeper", body: { action: "answer", questionId: contribution.questionId, cardId } });
      else if (contribution?.kind === "need") steps.push({ url: "/api/care", body: { action: "need-from-voice", cardId, forMemberId: contribution.forMemberId ?? viewer.id } });
      else if (contribution?.kind === "kid_ask") steps.push({ url: "/api/kid-ask", body: { action: "ask", topic: contribution.topic ?? "question", cardId, toMemberId: contribution.toMemberId ?? null } });
      else if (contribution?.kind === "kid_answer") steps.push({ url: "/api/kid-ask", body: { action: "answer", askId: contribution.askId, cardId } });
      else if (contribution?.kind === "bedtime") steps.push({ url: "/api/bedtime", body: { action: "create", forMemberId: contribution.forMemberId, cardId } });
      return steps;
    };
    const posted = await postVoice({ ...ready, caption: ready.transcript, addressedTo: addressTo(to), replyToCardId: contribution?.kind === "card_reply" ? contribution.cardId : undefined, listen, after });
    if (!posted.ok) {
      setNotice(null);
      setError("Couldn't send that recording. Try again.");
      setPhase("ready");
      return;
    }
    if (posted.queued) {
      setNotice("Saved. Couldn't send yet, will retry on its own.");
      window.setTimeout(onDone, 1600);
      return;
    }
    if (nightThere && letter && posted.id) {
      await fetch("/api/letters", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cardId: posted.id, deliverAt: morningAt() }) }).catch(() => null);
    }
    if (contribution && posted.id) {
      const json = (url: string, body: unknown) =>
        fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : null)).catch(() => null);
      if (contribution.kind === "wish" || contribution.kind === "blessing") {
        await json("/api/wishes", { ritualRunId: contribution.runId, cardId: posted.id, memberId: viewer.id, kind: contribution.kind });
      } else if (contribution.kind === "recipe") {
        const out = await json("/api/kitchen", { action: "teach", cardId: posted.id, title: contribution.title, questionId: contribution.questionId });
        const recipe = out?.recipe as { id?: string } | undefined;
        onDone();
        if (recipe?.id) router.push(`/kitchen/${recipe.id}`);
        return;
      } else if (contribution.kind === "story") {
        const out = await json("/api/stories", { action: "tell", cardId: posted.id, questionId: contribution.questionId });
        const story = out?.story as { id?: string } | undefined;
        onDone();
        if (story?.id) router.push(`/stories?new=${story.id}`);
        return;
      } else if (contribution.kind === "today") {
        await json("/api/today", { action: "answer", taskId: contribution.taskId, cardId: posted.id });
        window.dispatchEvent(new Event("aangan:today"));
      } else if (contribution.kind === "answer") {
        await json("/api/keeper", { action: "answer", questionId: contribution.questionId, cardId: posted.id });
      } else if (contribution.kind === "kid_ask") {
        await json("/api/kid-ask", { action: "ask", topic: contribution.topic ?? "question", cardId: posted.id, toMemberId: contribution.toMemberId ?? null });
      } else if (contribution.kind === "kid_answer") {
        await json("/api/kid-ask", { action: "answer", askId: contribution.askId, cardId: posted.id });
      } else if (contribution.kind === "bedtime") {
        await json("/api/bedtime", { action: "create", forMemberId: contribution.forMemberId, cardId: posted.id });
      } else if (contribution.kind === "need") {
        await json("/api/care", { action: "need-from-voice", cardId: posted.id, forMemberId: contribution.forMemberId ?? viewer.id });
        onDone();
        router.push("/care");
        return;
      }
    }
    if (notYetLine) {
      // Kept, not lost: say where it went before the sheet closes.
      setNotice(`Saved for ${notYet.join(" and ")}. It waits under Sent until they join.`);
      window.setTimeout(onDone, 2200);
      return;
    }
    onDone();
  };

  if (consent === false) {
    return (
      <div className="pt-2">
        <h2 className="m-0 text-title">Before your first recording</h2>
        <ul className="m-0 mt-4 list-none space-y-3 p-0 text-body text-ink-soft">
          <li className="flex gap-3"><Icon name="check" size={20} className="mt-0.5 shrink-0 text-ink" />Only your family can hear it.</li>
          <li className="flex gap-3"><Icon name="check" size={20} className="mt-0.5 shrink-0 text-ink" />Nearer writes down your words so everyone can read them in their own language.</li>
          <li className="flex gap-3"><Icon name="check" size={20} className="mt-0.5 shrink-0 text-ink" />Your voice is never used to create a copy of it.</li>
        </ul>
        <p className="m-0 mt-4 text-footnote text-ink-faint">In this demo, Meta&rsquo;s AI models process recordings to transcribe and translate them.</p>
        <Button
          className="mt-6 w-full"
          onClick={() => {
            try {
              localStorage.setItem(CONSENT_KEY, "1");
            } catch {
              /* private mode: consent lasts this session */
            }
            setConsent(true);
          }}
        >
          I understand
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[460px] flex-col">
      {purpose ? (
        <div className="rounded-[20px] bg-surface px-4 py-3">
          {(contribution?.kind === "answer" || contribution?.kind === "today" || (contribution?.kind === "story" && contribution.prompt)) && contribution.prompt && <Teleprompter text={contribution.prompt} />}
          {contribution?.kind === "recipe" && contribution.title && <p className="m-0 mb-1 text-headline font-semibold">{contribution.title}</p>}
          <p className="m-0 text-callout text-ink-soft">{purpose.hint}</p>
          {contribution?.kind === "need" && <p className="m-0 mt-2 text-footnote text-ink-soft">Everyone in the family will see this.</p>}
        </div>
      ) : (
        <>
          <p className="m-0 mb-3 text-footnote font-medium text-ink-soft">To</p>
          <Recipients value={to} onChange={setTo} />
          {/* "How to listen" (optional): only when it is for particular people; only they see it. */}
          {to.length > 0 && (
            <div data-ui="listen-pick" className="mt-3" role="radiogroup" aria-label="How to listen (optional)">
              <p className="m-0 mb-1.5 text-footnote font-medium text-ink-soft">How would you like it heard? (optional)</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(LISTEN_WORDS) as ListenWay[]).map((w) => (
                  <button key={w} type="button" role="radio" aria-checked={listen === w} onClick={() => setListen(listen === w ? null : w)} className={cn("press min-h-[44px] rounded-full px-3.5 text-footnote font-semibold", listen === w ? "bg-accent text-accent-ink" : "bg-tint text-ink")}>
                    {LISTEN_WORDS[w].replace(/^./, (c) => c.toUpperCase())}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        {phase === "ready" && ready ? (
          <div className="w-full">
            <div className="flex items-center gap-3 rounded-[22px] bg-surface p-3">
              <PlayButton
                tone="dark"
                size={44}
                playing={previewPlaying}
                label={previewPlaying ? "Pause preview" : "Play preview"}
                onClick={() => {
                  const a = audioRef.current;
                  if (!a) return;
                  if (a.paused) void a.play().then(() => setPreviewPlaying(true));
                  else {
                    a.pause();
                    setPreviewPlaying(false);
                  }
                }}
              />
              <div className="flex h-8 flex-1 items-center gap-[2.5px]" aria-hidden="true">
                {(ready.upload.peaks.length ? ready.upload.peaks : levels).slice(0, 40).map((v, i) => (
                  <span key={i} className="block flex-1 rounded-full bg-black/70" style={{ maxWidth: 3.5, height: `${Math.max(14, v * 100)}%` }} />
                ))}
              </div>
              <span className="tnum pr-1 text-footnote text-ink-soft">{formatDuration(seconds)}</span>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio ref={audioRef} src={ready.url} preload="auto" onEnded={() => setPreviewPlaying(false)} />
            </div>
            <p className="voice m-0 mt-5 px-2 text-left text-title leading-snug text-ink">
              {ready.unavailable ? "We couldn't write this one down, but your voice will still be heard." : `“${ready.transcript}”`}
            </p>
          </div>
        ) : (
          <>
            <div className="flex h-16 w-full items-center justify-center gap-[3px]" aria-hidden="true">
              {levels.map((v, i) => (
                <span
                  key={i}
                  className={cn("block w-[3px] rounded-full", phase === "recording" ? "bg-marigold" : "bg-tint")}
                  style={{ height: `${Math.max(8, v * 100)}%`, transition: "height 90ms linear" }}
                />
              ))}
            </div>
            <p className="tnum m-0 mt-4 text-body text-ink-soft" role="status">
              {phase === "recording" ? (
                <span className="inline-flex items-center gap-2">
                  <LiveDot />
                  {formatDuration(seconds)}
                </span>
              ) : phase === "working" ? (
                (notice ?? "Listening back…")
              ) : (
                purpose ? "Tap to start" : `Tap to talk${toLabel ? ` to ${toLabel}` : " to everyone"}`
              )}
            </p>
            <button
              type="button"
              onClick={phase === "recording" ? stop : () => void start()}
              disabled={phase === "working"}
              aria-label={phase === "recording" ? "Stop recording" : "Start recording"}
              className="press mt-5 grid h-[88px] w-[88px] place-items-center rounded-full bg-accent text-accent-ink disabled:opacity-40"
              style={{ boxShadow: phase === "recording" ? "0 0 0 8px var(--marigold-glow)" : "0 14px 30px rgba(0,0,0,.25)" }}
            >
              <Icon name={phase === "recording" ? "stop" : "mic"} size={34} />
            </button>
          </>
        )}
        {error && (
          <p className="m-0 mt-4 text-callout text-[#b42318]" role="alert">
            {error}
          </p>
        )}
      </div>


      {notYetLine && !purpose && (phase === "idle" || phase === "ready") && (
        <p data-ui="not-joined-note" className="m-0 mb-3 rounded-[16px] bg-surface px-4 py-3 text-callout text-ink-soft" role="status">
          {notYetLine}
        </p>
      )}

      {phase === "ready" && nightThere && (
        <button type="button" role="switch" aria-checked={letter} onClick={() => setLetter((v) => !v)} className="press mb-2 flex w-full items-center gap-3 rounded-[18px] border border-[var(--line)] px-3.5 py-3 text-left">
          <Icon name="coffee" size={20} />
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold">Morning letter</span>
            <span className="block text-caption text-ink-soft">It&rsquo;s night there. Arrives at 7:30 AM their time.</span>
          </span>
          <span className={cn("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors", letter ? "bg-ink" : "bg-black/15")}>
            <span className={cn("absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all", letter ? "left-[21px]" : "left-[3px]")} />
          </span>
        </button>
      )}
      {phase === "ready" ? (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={discard}>
            Record again
          </Button>
          <Button className="flex-[1.4]" onClick={() => void send()}>
            <Icon name="send" size={18} />
            {purpose ? purpose.cta : nightThere && letter ? "Send for the morning" : `Send${toLabel ? ` to ${toLabel}` : ""}`}
          </Button>
        </div>
      ) : (
        phase === "idle" && !purpose && (
          <div>
            <button type="button" onClick={() => setIdeas((v) => !v)} aria-expanded={ideas} className="press mx-auto flex h-11 items-center gap-1.5 text-body font-medium text-ink-soft">
              Need something to say?
              <Icon name="down" size={16} className={cn("transition-transform", ideas && "rotate-180")} />
            </button>
            {ideas && (
              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {ASK_STARTERS.en.map((q) => (
                  <li key={q} className="voice rounded-[18px] bg-surface px-4 py-3 text-body text-ink">
                    {q}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- moment */
function MomentComposer({ onDone, contribution = null, addressee }: { onDone: () => void; contribution?: ReplyContribution | null; addressee: string[] | null }) {
  const { viewer, members } = useViewer();
  // "Add to the fridge": whose is it? Only the family's kids; one tap, no default when there are several.
  const fridge = contribution?.kind === "fridge";
  const kids = useMemo(() => (fridge ? members.filter((m) => isKid(m) && m.status !== "pending") : []), [fridge, members]);
  const [photoRecipients, setPhotoRecipients] = useState<string[]>(addressee ?? []);
  const [whose, setWhose] = useState<string>(contribution?.kind === "fridge" ? (contribution.forMemberId ?? "") : "");
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  // Muse writes a caption for a single photo; the person edits or clears it before posting.
  const [suggesting, setSuggesting] = useState(false);
  // Written on the print: where (their home city to start with) and a short note.
  const home = viewer.city || (placeFromTz(viewer.tz) === "Somewhere" ? "" : placeFromTz(viewer.tz));
  const [where, setWhere] = useState(home);
  const [printNote, setPrintNote] = useState("");
  // Glasses photos are recognised from the camera metadata itself (EXIF
  // Make/Model); there is no manual claim.
  const glasses = false;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  // Muse's one offer here: restore a single old photo (kept only if the person chooses it).
  const [restored, setRestored] = useState<Restored | null>(null);
  const single = files.length === 1 && files[0].type.startsWith("image/") ? files[0] : null;
  const inputRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => ({ url: URL.createObjectURL(f), video: f.type.startsWith("video/") })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  useEffect(() => {
    if (!single || fridge || single.size > 5 * 1024 * 1024) return;
    let live = true;
    setSuggesting(true);
    const form = new FormData();
    form.append("media", single, single.name || "photo");
    fetch("/api/cards/caption", { method: "POST", body: form })
      .then((r) => (r.ok ? (r.json() as Promise<{ caption?: string }>) : null))
      .then((d) => {
        if (live && d?.caption) setNote((cur) => (cur.trim() ? cur : (d.caption as string).slice(0, 280)));
      })
      .catch(() => undefined)
      .finally(() => live && setSuggesting(false));
    return () => {
      live = false;
      setSuggesting(false);
    };
  }, [single, fridge]);

  const share = async () => {
    setBusy(true);
    setError(null);
    let failed = 0;
    let queued = 0;
    for (const file of files) {
      try {
        const video = file.type.startsWith("video/");
        const upload = video
          ? await processVideo(file, { fromToday: true, fromGlassesToggle: glasses })
          : await processImage(file, { fromToday: true, fromGlassesToggle: glasses });
        if (restored && file === single) {
          // The restored picture becomes the card; the original travels with it.
          if (!(await keepRender({ runId: restored.runId, blob: restored.blob, caption: note.trim(), takenAt: upload.takenAt, place: where.trim(), note: printNote.trim(), originalRef: upload.mediaRef }))) failed += 1;
          continue;
        }
        const stored = getSessionMedia(upload.mediaRef)?.blob ?? file;
        const frames = video ? await extractVideoFrames(file).catch(() => []) : [];
        setSending("Saved, sending…");
        const out = await postMoment(upload, stored, note.trim(), viewer.lang, frames, fridge ? { forMemberId: whose } : { place: where.trim(), note: printNote.trim(), captionFinal: files.length === 1 && !video, addressedTo: addressTo(photoRecipients) });
        if (out === "dropped") failed += 1;
        else if (out === "queued") queued += 1;
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    if (failed === 0 && queued === 0) {
      setSending("Sent");
      window.setTimeout(onDone, 500);
    } else if (failed === 0) {
      setSending("Saved. Couldn't send yet, will retry on its own.");
      window.setTimeout(onDone, 1800);
    } else {
      setSending(null);
      setError(`${failed} of ${files.length} didn't upload. Videos must be 30 seconds or shorter.`);
    }
  };

  return (
    <div className="flex min-h-[460px] flex-col">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        aria-label="Choose photos or a video"
        onChange={(e) => {
          setRestored(null);
          setFiles(Array.from(e.target.files ?? []).slice(0, 10));
        }}
      />
      {files.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="press flex flex-1 flex-col items-center justify-center gap-3 rounded-[26px] bg-surface py-14 text-ink"
        >
          <span className="grid h-16 w-16 place-items-center rounded-full bg-white shadow-frost">
            <Icon name="image" size={28} />
          </span>
          <span className="text-headline font-semibold">Choose photos or a video</span>
          <span className="text-callout text-ink-soft">From today, or any day you want to keep</span>
        </button>
      ) : (
        <div className="grid flex-1 grid-cols-3 content-start gap-1.5">
          {previews.map((p, i) => (
            <div key={i} className="relative aspect-square overflow-hidden rounded-[14px] bg-surface">
              {p.video ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={p.url} className="h-full w-full object-cover" muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.url} alt="" className="h-full w-full object-cover" />
              )}
            </div>
          ))}
          <button type="button" onClick={() => inputRef.current?.click()} aria-label="Choose different files" className="press grid aspect-square place-items-center rounded-[14px] bg-surface text-ink-soft">
            <Icon name="plus" />
          </button>
        </div>
      )}

      {fridge && (
        <fieldset className="m-0 mt-4 border-0 p-0" data-ui="fridge-whose">
          <legend className="mb-2 p-0 text-body font-semibold">Whose is this?</legend>
          <div className="flex flex-wrap gap-2">
            {kids.map((k) => (
              <button key={k.id} type="button" aria-pressed={whose === k.id} onClick={() => setWhose(k.id)} className={cn("press flex h-11 items-center gap-2 rounded-full pl-1.5 pr-4 text-body font-semibold", whose === k.id ? "bg-accent text-accent-ink" : "bg-surface text-ink")}>
                <Avatar src={memberPhoto(k)} name={callName(k)} size={32} />
                {callName(k)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {single && !fridge && <RestoreOffer key={`${single.name}-${single.size}-${single.lastModified}`} file={single} onChange={setRestored} />}

      <label className="mt-4 block">
        <span className="sr-only">Caption</span>
        <input
          type="text"
          value={note}
          maxLength={280}
          onChange={(e) => {
            setNote(e.target.value);
          }}
          placeholder={fridge ? "What is it? (optional)" : suggesting ? "Writing a caption…" : "Caption (edit or clear it)"}
          className="h-12 w-full rounded-full bg-surface px-5 text-body outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-marigold"
        />
      </label>
      {!fridge && (
      <div className="mt-3 rounded-[22px] border border-[var(--line)] p-3">
        <p className="m-0 px-1 text-footnote font-medium text-ink-soft">Written on the print</p>
        <label className="mt-2 flex items-center gap-3">
          <span className="w-[64px] shrink-0 px-1 text-body font-semibold">Where</span>
          <input
            type="text"
            value={where}
            maxLength={CARD_PLACE_MAX}
            onChange={(e) => setWhere(e.target.value)}
            placeholder="Amritsar"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 rounded-[14px] bg-surface px-4 text-body outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-marigold"
          />
        </label>
        <label className="mt-2 flex items-center gap-3">
          <span className="w-[64px] shrink-0 px-1 text-body font-semibold">A note</span>
          <input
            type="text"
            value={printNote}
            maxLength={CARD_NOTE_MAX}
            onChange={(e) => setPrintNote(e.target.value)}
            placeholder="Optional, in your words"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 rounded-[14px] bg-surface px-4 font-hand text-title outline-none placeholder:font-sans placeholder:text-body placeholder:text-ink-faint focus:ring-2 focus:ring-marigold"
          />
        </label>
      </div>
      )}
      {error && (
        <p className="m-0 mt-2 text-callout text-[#b42318]" role="alert">
          {error}
        </p>
      )}
      {sending && (
        <p className="m-0 mt-2 text-callout text-ink-soft" role="status">
          {sending}
        </p>
      )}
      {!fridge && files.length > 0 && (
        <div className="mt-4">
          <p className="m-0 mb-2 text-footnote font-medium text-ink-soft">To</p>
          <Recipients value={photoRecipients} onChange={setPhotoRecipients} />
        </div>
      )}
      <Button className="mt-4 w-full" disabled={files.length === 0 || busy || sending !== null || (fridge && !whose)} onClick={() => void share()}>
        {busy ? "Sharing…" : fridge ? (whose ? PURPOSE.fridge.cta : "Choose whose it is") : photoRecipients.length ? "Send privately" : files.length > 1 ? `Share ${files.length} with the family` : "Share with the family"}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ sheet */
export function AddSheet() {
  const { addOpen, addTab, replyTo, addressee, closeAdd, bumpRefresh } = useShell();
  const voice = addTab === "voice" || addTab === "ask";

  const done = () => {
    bumpRefresh();
    closeAdd();
  };

  return (
    <BottomSheet
      open={addOpen}
      onClose={closeAdd}
      title={voice ? (purposeTitle(replyTo) ?? "New voice memory") : (purposeTitle(replyTo?.kind === "fridge" ? replyTo : null) ?? "Share a moment")}
      dataUi="add-sheet"
      z={50}
    >
      {voice ? <VoiceComposer addressee={addressee} contribution={replyTo} onDone={done} /> : <MomentComposer onDone={done} contribution={replyTo} addressee={addressee} />}
    </BottomSheet>
  );
}
