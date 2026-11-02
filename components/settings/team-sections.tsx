"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Icon } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { blobToWav16k } from "@/lib/media-client";
import type { ClientError } from "@/lib/client-errors";
import type { FamilyMetrics } from "@/lib/metrics";
import { useJson } from "@/lib/use-json";
import { Group } from "./section";

// For the people who look after the family (owners and admins): three honest numbers about whether
// Nearer is helping the generations reach each other, and the last problems the app ran into.
// For everyone: a way to tell the Nearer team something by voice.

const pct = (share: number | null) => (share === null ? "–" : `${Math.round(share * 100)}%`);

function Stat({ id, label, value, note }: { id: string; label: string; value: string; note: string }) {
  return (
    <div data-ui={id} className="rounded-[22px] bg-surface px-4 py-4">
      <p className="m-0 text-footnote text-ink-soft">{label}</p>
      <p data-display className="tnum m-0 mt-0.5 text-display font-bold">{value}</p>
      <p className="m-0 mt-1 text-footnote text-ink-soft">{note}</p>
    </div>
  );
}

/** "How we're doing": three numbers, each in words. Owners and admins only. */
export function HowWereDoing() {
  const { data, failed } = useJson<FamilyMetrics>("/api/metrics");
  return (
    <Group title="How we're doing" id="how-were-doing">
      {!data ? (
        <p className="m-0 text-body text-ink-soft">{failed ? "Couldn't load this right now." : "Counting…"}</p>
      ) : (
        <div className="grid gap-3">
          <Stat
            id="metric-two-way"
            label="Two-way week"
            value={`${data.twoWayWeek.days} of ${data.twoWayWeek.of} days`}
            note="Days this week when a parent reached toward a child and a child reached toward a parent."
          />
          <Stat
            id="metric-bids"
            label="Voice memories answered within a day"
            value={data.bidsAnswered.share === null ? "None to count yet" : `${pct(data.bidsAnswered.share)} · ${data.bidsAnswered.answered} of ${data.bidsAnswered.total}`}
            note="Parents' voice memories from the last 30 days that got a note back, a reaction or a wish within 24 hours. Listening alone doesn't count."
          />
          <Stat
            id="metric-parent-days"
            label="Parent active days"
            value={data.parentActiveDays.typical === null ? "No parent yet" : `${data.parentActiveDays.typical} of ${data.parentActiveDays.of} days`}
            note={data.parentActiveDays.perParent.length > 1 ? data.parentActiveDays.perParent.map((p) => `${p.name} ${p.days}`).join(" · ") : "Days in the last 30 when a parent shared, sent, played, reacted or lit the lamp."}
          />
        </div>
      )}
    </Group>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The last 50 problems the app ran into on this family's phones. Owners and admins only. */
export function ProblemsSeen() {
  const { data, failed } = useJson<{ errors: ClientError[] }>("/api/beacon");
  const errors = data?.errors ?? [];
  return (
    <Group title="Problems the app ran into" id="problems-seen">
      <p className="m-0 mb-3 text-footnote text-ink-soft">The last 50. Only the page, the message and the device type are kept: no names, no messages, nothing you typed.</p>
      {!data ? (
        <p className="m-0 text-body text-ink-soft">{failed ? "Couldn't load this right now." : "Loading…"}</p>
      ) : errors.length === 0 ? (
        <p className="m-0 text-body text-ink-soft">Nothing has gone wrong lately.</p>
      ) : (
        <ul className="m-0 list-none space-y-2 p-0">
          {errors.map((e) => (
            <li key={e.id} className="rounded-[18px] bg-surface px-4 py-3">
              <p className="m-0 text-callout font-medium">{e.message}</p>
              <p className="m-0 mt-0.5 text-footnote text-ink-soft">
                {e.route} · {e.ua} · {e.build || "unknown build"} · {when(e.at)}
              </p>
              {e.stack && <pre className="m-0 mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-snug text-ink-faint">{e.stack}</pre>}
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
}

type Note = { id: string; memberId: string; text: string; at: string };
const MAX_SECONDS = 120;

/** Record a short voice note to the Nearer team. The words are kept, not the voice. */
export function TellUsByVoice({ onMessage }: { onMessage: (m: string) => void }) {
  const { viewer, members } = useViewer();
  const { data, reload } = useJson<{ feedback: Note[]; seesAll: boolean }>("/api/feedback");
  const [phase, setPhase] = useState<"idle" | "recording" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === "recording" && seconds >= MAX_SECONDS) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, phase]);
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const send = async (blob: Blob, durationMs: number) => {
    setPhase("sending");
    try {
      const wav = await blobToWav16k(blob);
      const form = new FormData();
      form.append("audio", new Blob([wav.bytes as unknown as BlobPart], { type: "audio/wav" }), "voice.wav");
      form.append("langHint", viewer.displayLang ?? "en");
      form.append("durationMs", String(Math.min(300_000, Math.round(durationMs))));
      const res = await fetch("/api/feedback", { method: "POST", body: form });
      if (res.status === 429) throw new Error("rate");
      if (!res.ok) throw new Error("failed");
      await reload();
      onMessage("Thank you. The team will read this.");
    } catch (e) {
      setError((e as Error).message === "rate" ? "That's a few already. Try again in a while." : "Couldn't make that out. Try again, a little closer to the phone.");
    } finally {
      setPhase("idle");
    }
  };

  const start = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm", "audio/mp4"].find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = () => void send(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }), Date.now() - startedAt.current);
      recRef.current = rec;
      streamRef.current = s;
      startedAt.current = Date.now();
      setSeconds(0);
      rec.start();
      setPhase("recording");
    } catch {
      setError("Nearer needs your microphone. Allow it in your browser settings, then try again.");
    }
  };

  function stop() {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName || "Someone";
  const notes = data?.feedback ?? [];
  return (
    <Group title="Tell us by voice" id="tell-us">
      <p className="m-0 mb-3 text-footnote text-ink-soft">Something that confused you, broke, or you wish it did? Say it in your own words, up to two minutes. We keep the words, not your voice. Family owners and admins can read them too.</p>
      {phase === "recording" ? (
        <Button className="w-full" onClick={stop}>
          Stop · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </Button>
      ) : (
        <Button className="w-full" disabled={phase === "sending"} onClick={() => void start()}>
          <Icon name="mic" size={18} className="mr-2" />
          {phase === "sending" ? "Sending…" : "Record a note"}
        </Button>
      )}
      {error && <p role="alert" className="m-0 mt-2 text-footnote text-[#b42318]">{error}</p>}
      {notes.length > 0 && (
        <ul className="m-0 mt-4 list-none space-y-2 p-0">
          {notes.map((n) => (
            <li key={n.id} className="rounded-[18px] bg-surface px-4 py-3">
              <p className="m-0 text-callout">{n.text}</p>
              <p className="m-0 mt-0.5 text-footnote text-ink-soft">
                {data?.seesAll ? `${nameOf(n.memberId)} · ` : ""}
                {when(n.at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
}
