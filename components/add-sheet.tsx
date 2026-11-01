"use client";

import { AnimatePresence, m } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addressTo, householdName, households } from "@/lib/households";
import { ASK_STARTERS } from "@/lib/i18n";
import { blobToWav16k, extractVideoFrames, processImage, processVideo, processVoiceBlob, type ProcessedUpload } from "@/lib/media-client";
import { getSessionMedia } from "@/lib/media-session";
import { uploadQueue, type Outcome } from "@/lib/upload-queue";
import { callName, formatDuration, memberPhoto } from "@/lib/people";
import type { TranscriptSegment } from "@/lib/schemas";
import { CARD_NOTE_MAX, CARD_PLACE_MAX } from "@/lib/card-limits";
import { cn } from "@/lib/utils";
import { hourIn, placeFromTz } from "@/lib/zones";
import { keepRender } from "@/lib/muse-canvas";
import { RestoreOffer, type Restored } from "./muse-restore";
import { useShell } from "./shell";
import { Avatar, Button, Icon, LiveDot, PlayButton } from "./ui/kit";
import { useViewer } from "./viewer";

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
  | { kind: "today"; taskId: string; prompt: string };

const PURPOSE: Record<"recipe" | "answer" | "need" | "story" | "today", { title: string; hint: string; cta: string }> = {
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
async function postMoment(upload: ProcessedUpload, file: File | Blob, caption: string, lang: string, frames: Blob[] = [], extra: { place?: string; note?: string } = {}): Promise<Outcome> {
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
/** Who a voice note is for: whole homes first ("Maa & Papa"), then any mix of people, or everyone. */
function Recipients({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { viewer, members, relationships } = useViewer();
  const homes = households(members, relationships).filter((h) => !h.members.some((m) => m.id === viewer.id) && h.members.length > 1);
  const others = members.filter((mm) => mm.id !== viewer.id);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const isHome = (ids: string[]) => ids.length === value.length && ids.every((id) => value.includes(id));
  return (
    <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5" role="group" aria-label="Who is this for">
      {homes.map((h) => {
        const ids = h.members.map((m) => m.id);
        const on = isHome(ids);
        return (
          <button key={h.id} type="button" aria-pressed={on} onClick={() => onChange(on ? [] : ids)} className={cn("press flex h-11 shrink-0 items-center gap-2 rounded-full pl-1 pr-4 text-[15px] font-medium", on ? "bg-black text-white" : "bg-surface text-ink")}>
            <span className="flex -space-x-2">
              {h.members.slice(0, 2).map((m) => (
                <Avatar key={m.id} src={memberPhoto(m)} name={callName(m)} size={30} />
              ))}
            </span>
            {householdName(h, (m) => callName(m))}
          </button>
        );
      })}
      {others.map((mm) => {
        const on = value.includes(mm.id) && !homes.some((h) => isHome(h.members.map((m) => m.id)));
        return (
          <button
            key={mm.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(mm.id)}
            className={cn("press flex h-11 shrink-0 items-center gap-2 rounded-full pl-1 pr-4 text-[15px] font-medium", on ? "bg-black text-white" : "bg-surface text-ink")}
          >
            <Avatar src={memberPhoto(mm)} name={callName(mm)} size={34} />
            {callName(mm)}
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={value.length === 0}
        onClick={() => onChange([])}
        className={cn("press h-11 shrink-0 rounded-full px-4 text-[15px] font-medium", value.length === 0 ? "bg-black text-white" : "bg-surface text-ink")}
      >
        Everyone
      </button>
    </div>
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
  const { viewer, members, relationships, displayLang } = useViewer();
  const purpose = contribution && contribution.kind !== "wish" && contribution.kind !== "blessing" ? PURPOSE[contribution.kind] : null;
  const [to, setTo] = useState<string[]>(addressee ?? []);
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
      setError("Aangan needs your microphone. Allow it in your browser settings, then try again.");
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
      return steps;
    };
    const posted = await postVoice({ ...ready, caption: ready.transcript, addressedTo: addressTo(to), after });
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
      } else if (contribution.kind === "need") {
        await json("/api/care", { action: "need-from-voice", cardId: posted.id, forMemberId: contribution.forMemberId ?? viewer.id });
        onDone();
        router.push("/care");
        return;
      }
    }
    onDone();
  };

  if (consent === false) {
    return (
      <div className="pt-2">
        <h2 className="m-0 text-[24px]">Before your first recording</h2>
        <ul className="m-0 mt-4 list-none space-y-3 p-0 text-[15px] text-ink-soft">
          <li className="flex gap-3"><Icon name="check" size={20} className="mt-0.5 shrink-0 text-ink" />Only your family can hear it.</li>
          <li className="flex gap-3"><Icon name="check" size={20} className="mt-0.5 shrink-0 text-ink" />Aangan writes down your words so everyone can read them in their own language.</li>
          <li className="flex gap-3"><Icon name="check" size={20} className="mt-0.5 shrink-0 text-ink" />Your voice is never used to create a copy of it.</li>
        </ul>
        <p className="m-0 mt-4 text-[13px] text-ink-faint">In this demo, Meta&rsquo;s AI models process recordings to transcribe and translate them.</p>
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
          {(contribution?.kind === "answer" || contribution?.kind === "today" || (contribution?.kind === "story" && contribution.prompt)) && <p className="voice m-0 mb-1 text-[19px] leading-snug text-ink">“{contribution.prompt}”</p>}
          {contribution?.kind === "recipe" && contribution.title && <p className="m-0 mb-1 text-[17px] font-semibold">{contribution.title}</p>}
          <p className="m-0 text-[14px] text-ink-soft">{purpose.hint}</p>
        </div>
      ) : (
        <>
          <p className="m-0 mb-3 text-[13px] font-medium text-ink-soft">To</p>
          <Recipients value={to} onChange={setTo} />
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
              <span className="tnum pr-1 text-[13px] text-ink-soft">{formatDuration(seconds)}</span>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio ref={audioRef} src={ready.url} preload="auto" onEnded={() => setPreviewPlaying(false)} />
            </div>
            <p className="voice m-0 mt-5 px-2 text-left text-[19px] leading-snug text-ink">
              {ready.unavailable ? "We couldn't write this one down, but your voice will still be heard." : `“${ready.transcript}”`}
            </p>
          </div>
        ) : (
          <>
            <div className="flex h-16 w-full items-center justify-center gap-[3px]" aria-hidden="true">
              {levels.map((v, i) => (
                <span
                  key={i}
                  className={cn("block w-[3px] rounded-full", phase === "recording" ? "bg-marigold" : "bg-black/10")}
                  style={{ height: `${Math.max(8, v * 100)}%`, transition: "height 90ms linear" }}
                />
              ))}
            </div>
            <p className="tnum m-0 mt-4 text-[15px] text-ink-soft" role="status">
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
              className="press mt-5 grid h-[88px] w-[88px] place-items-center rounded-full bg-black text-white disabled:opacity-40"
              style={{ boxShadow: phase === "recording" ? "0 0 0 8px var(--marigold-glow)" : "0 14px 30px rgba(0,0,0,.25)" }}
            >
              <Icon name={phase === "recording" ? "stop" : "mic"} size={34} />
            </button>
          </>
        )}
        {error && (
          <p className="m-0 mt-4 text-[14px] text-[#b42318]" role="alert">
            {error}
          </p>
        )}
      </div>

      {phase === "ready" && nightThere && (
        <button type="button" role="switch" aria-checked={letter} onClick={() => setLetter((v) => !v)} className="press mb-2 flex w-full items-center gap-3 rounded-[18px] border border-[var(--line)] px-3.5 py-3 text-left">
          <Icon name="coffee" size={20} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Morning letter</span>
            <span className="block text-[12.5px] text-ink-soft">It&rsquo;s night there. Arrives at 7:30 AM their time.</span>
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
            <button type="button" onClick={() => setIdeas((v) => !v)} aria-expanded={ideas} className="press mx-auto flex h-11 items-center gap-1.5 text-[15px] font-medium text-ink-soft">
              Need something to say?
              <Icon name="down" size={16} className={cn("transition-transform", ideas && "rotate-180")} />
            </button>
            {ideas && (
              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {ASK_STARTERS.en.map((q) => (
                  <li key={q} className="voice rounded-[18px] bg-surface px-4 py-3 text-[16px] text-ink">
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
function MomentComposer({ onDone }: { onDone: () => void }) {
  const { viewer } = useViewer();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
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
        const out = await postMoment(upload, stored, note.trim(), viewer.lang, frames, { place: where.trim(), note: printNote.trim() });
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
          <span className="text-[17px] font-semibold">Choose photos or a video</span>
          <span className="text-[14px] text-ink-soft">From today, or any day you want to keep</span>
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

      {single && <RestoreOffer key={`${single.name}-${single.size}-${single.lastModified}`} file={single} onChange={setRestored} />}

      <label className="mt-4 block">
        <span className="sr-only">Caption</span>
        <input
          type="text"
          value={note}
          maxLength={280}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Caption (optional)"
          className="h-[52px] w-full rounded-full bg-surface px-5 text-[16px] outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-marigold"
        />
      </label>
      <div className="mt-3 rounded-[22px] border border-[var(--line)] p-3">
        <p className="m-0 px-1 text-[13px] font-medium text-ink-soft">Written on the print</p>
        <label className="mt-2 flex items-center gap-3">
          <span className="w-[64px] shrink-0 px-1 text-[15px] font-semibold">Where</span>
          <input
            type="text"
            value={where}
            maxLength={CARD_PLACE_MAX}
            onChange={(e) => setWhere(e.target.value)}
            placeholder="Amritsar"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 rounded-[14px] bg-surface px-4 text-[16px] outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-marigold"
          />
        </label>
        <label className="mt-2 flex items-center gap-3">
          <span className="w-[64px] shrink-0 px-1 text-[15px] font-semibold">A note</span>
          <input
            type="text"
            value={printNote}
            maxLength={CARD_NOTE_MAX}
            onChange={(e) => setPrintNote(e.target.value)}
            placeholder="Optional, in your words"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 rounded-[14px] bg-surface px-4 font-hand text-[19px] outline-none placeholder:font-sans placeholder:text-[16px] placeholder:text-ink-faint focus:ring-2 focus:ring-marigold"
          />
        </label>
      </div>
      {error && (
        <p className="m-0 mt-2 text-[14px] text-[#b42318]" role="alert">
          {error}
        </p>
      )}
      {sending && (
        <p className="m-0 mt-2 text-[14px] text-ink-soft" role="status">
          {sending}
        </p>
      )}
      <Button className="mt-4 w-full" disabled={files.length === 0 || busy || sending !== null} onClick={() => void share()}>
        {busy ? "Sharing…" : files.length > 1 ? `Share ${files.length} with the family` : "Share with the family"}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ sheet */
export function AddSheet() {
  const { addOpen, addTab, replyTo, addressee, closeAdd, bumpRefresh } = useShell();
  const voice = addTab === "voice" || addTab === "ask";

  useEffect(() => {
    if (!addOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeAdd();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addOpen, closeAdd]);

  const done = () => {
    bumpRefresh();
    closeAdd();
  };

  return (
    <AnimatePresence>
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={voice ? "Record a voice note" : "Share a photo or video"} data-ui="add-sheet">
          <m.button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeAdd}
          />
          <m.div
            className="relative max-h-[92vh] w-full max-w-[480px] overflow-y-auto rounded-t-[32px] bg-white px-5 pt-3 shadow-frost"
            style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36 }}
          >
            <span className="mx-auto mb-2 block h-1.5 w-10 rounded-full bg-black/15" aria-hidden="true" />
            <div className="mb-4 flex items-center justify-between">
              <h2 className="m-0 text-[22px]">{voice ? (purposeTitle(replyTo) ?? "New voice note") : "Share a moment"}</h2>
              <button type="button" onClick={closeAdd} aria-label="Close" className="press -mr-2 grid h-11 w-11 place-items-center rounded-full text-ink-soft">
                <Icon name="close" />
              </button>
            </div>
            {voice ? <VoiceComposer addressee={addressee} contribution={replyTo} onDone={done} /> : <MomentComposer onDone={done} />}
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
}
