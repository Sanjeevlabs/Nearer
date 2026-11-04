"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Icon } from "@/components/ui/kit";
import { useShell } from "@/components/shell";
import { VenueScene, type Sitter } from "@/components/venue-scene";
import { useViewer } from "@/components/viewer";
import { CALL_TOOLBAR, deniedReason, jitsiConfig, jitsiHash, mediaAllowed, stillOpen, type CallPhase, type JoinMedia } from "@/lib/call-gate";
import { doorLine } from "@/lib/doors";
import type { Knock, Sitting } from "@/lib/kinds";
import type { Member } from "@/lib/schemas";
import { callName, memberPhoto } from "@/lib/people";
import { postJson, useJson } from "@/lib/use-json";
import { venueOf } from "@/lib/venues";
import { placeFromTz, timeIn } from "@/lib/zones";

// Sitting together, inside Nearer: a venue (courtyard, terrace...) with the family on
// their seats, and the video room as the table in the middle. Only a door (knock or
// sitting) this person may see opens a room; its name is the random id.
//
// Consent first: our own pre-join screen comes before any Jitsi code. Nothing that can
// start the microphone or camera (the Jitsi script, its iframe, getUserMedia) runs until
// "Join with audio" or "Join with video" is tapped (lib/call-gate.ts). While in the room
// the door is re-checked every 60 s: closed or past its time, the room ends.

type JitsiApi = {
  executeCommand: (name: string, ...args: unknown[]) => void;
  addListener: (event: string, fn: (e: { id?: string; displayName?: string }) => void) => void;
  dispose: () => void;
};
declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (domain: string, options: Record<string, unknown>) => JitsiApi;
  }
}

type RoomInfo = { provider: "jaas" | "jitsi"; domain: string; appId?: string; room: string; jwt?: string };
const roomName = (r: RoomInfo) => (r.provider === "jaas" ? `${r.appId}/${r.room}` : r.room);
const scriptFor = (r: RoomInfo) => (r.provider === "jaas" ? `https://${r.domain}/${r.appId}/external_api.js` : `https://${r.domain}/external_api.js`);

/** Ask the browser once, after the tap, so a block shows our calm message instead of a blank room. */
async function askBrowser(media: JoinMedia): Promise<"ok" | "blocked" | "missing"> {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!md?.getUserMedia) return "ok"; // nothing to ask here; the room will ask itself
  try {
    const stream = await md.getUserMedia({ audio: true, video: media === "video" });
    stream.getTracks().forEach((t) => t.stop());
    return "ok";
  } catch (e) {
    const why = deniedReason(e);
    return why === "missing" ? "missing" : "blocked";
  }
}

const BTN = "press flex h-12 w-full items-center justify-center gap-2 rounded-full text-body font-semibold";

export default function CallPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { setChromeHidden } = useShell();
  const { viewer, members } = useViewer();
  // The door is re-checked every 60 s (never faster), before and during the call.
  const sit = useJson<{ sittings: Sitting[]; knocks: Knock[] }>("/api/sit", { every: 60_000 });
  const [phase, setPhase] = useState<CallPhase>("checking");
  const [media, setMedia] = useState<JoinMedia | null>(null);
  const [blockedVideo, setBlockedVideo] = useState(false);
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [mode, setMode] = useState<"loading" | "api" | "iframe">("loading");
  const [live, setLive] = useState<{ pid: string; mid: string }[]>([]);
  const holder = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiApi | null>(null);
  useEffect(() => {
    setChromeHidden(true);
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      clearInterval(t);
      setChromeHidden(false);
    };
  }, [setChromeHidden]);

  const data = sit.data;
  const knock = data?.knocks.find((k) => k.id === id);
  const sitting = data?.sittings.find((s) => s.id === id);
  const found = knock ?? sitting;
  const hostId = knock?.memberId ?? sitting?.hostId ?? null;
  // The host stays known after the door is gone, for "{Host} closed the door".
  const lastHost = useRef<Member | undefined>(undefined);
  const host = members.find((m) => m.id === hostId) ?? lastHost.current;
  if (host) lastHost.current = host;
  const isHost = host?.id === viewer.id;
  const inRoom = phase === "in";
  const venue = venueOf(found?.venue);
  const open = stillOpen(knock ? { until: knock.until } : sitting ? { startsAt: sitting.startsAt } : undefined, (now ?? new Date()).getTime());
  const title = sitting?.title ?? (knock ? (isHost ? "Your door is open" : `${callName(host)}'s door is open`) : "Sitting together");

  // Before joining: an unknown or expired door is closed. While in it: the host closed it, or its time ran out.
  useEffect(() => {
    if (!data) return;
    if (phase === "checking") setPhase(open ? "prejoin" : "closed");
    else if (phase === "prejoin" && !open) setPhase("closed");
    else if ((phase === "in" || phase === "connecting") && !open) setPhase("ended");
  }, [data, open, phase]);
  useEffect(() => {
    if (phase === "checking" && sit.failed && !data) setPhase("closed");
  }, [phase, sit.failed, data]);

  const dispose = useCallback(() => {
    try {
      apiRef.current?.dispose();
    } catch {
      /* already gone */
    }
    apiRef.current = null;
  }, []);

  // The door closed while in it: say so, then go home.
  useEffect(() => {
    if (phase !== "ended") return;
    dispose();
    const t = window.setTimeout(() => router.replace("/"), 6000);
    return () => window.clearTimeout(t);
  }, [phase, dispose, router]);

  const join = async (want: JoinMedia) => {
    setPhase("connecting");
    setBlockedVideo(false);
    let chosen = want;
    let asked = await askBrowser(chosen);
    // No camera on this device: audio only, said plainly on screen.
    if (asked === "missing" && chosen === "video") {
      chosen = "audio";
      asked = await askBrowser(chosen);
    }
    if (asked !== "ok") {
      setBlockedVideo(want === "video");
      setPhase("denied");
      return;
    }
    setMedia(chosen);
    try {
      const res = await fetch(`/api/sit/token?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (res.status === 404) return setPhase("closed");
      if (!res.ok) throw new Error(String(res.status));
      setInfo((await res.json()) as RoomInfo);
      setMode("loading");
      setPhase("in");
    } catch {
      setPhase("denied");
    }
  };

  // The video room, only after the tap: Jitsi's IFrame API (the venue photo is a CSS frame around the call, never inside the video);
  // the plain iframe if the script is slow (6 s) or fails.
  useEffect(() => {
    if (!inRoom || !info || !media) return;
    let gone = false;
    const fallback = window.setTimeout(() => !gone && !apiRef.current && setMode("iframe"), 6000);
    const start = () => {
      if (gone || !holder.current || !window.JitsiMeetExternalAPI) return;
      try {
        const api = new window.JitsiMeetExternalAPI(info.domain, {
          roomName: roomName(info),
          jwt: info.jwt,
          parentNode: holder.current,
          width: "100%",
          height: "100%",
          userInfo: { displayName: callName(viewer) },
          configOverwrite: jitsiConfig(media),
          interfaceConfigOverwrite: { TOOLBAR_BUTTONS: [...CALL_TOOLBAR], SHOW_JITSI_WATERMARK: false, SHOW_BRAND_WATERMARK: false, MOBILE_APP_PROMO: false },
        });
        apiRef.current = api;
        window.clearTimeout(fallback);
        setMode("api");
        api.addListener("videoConferenceJoined", () => void postJson("/api/sit", { action: "joined", id }));
        api.addListener("participantJoined", (e) => {
          const m = members.find((x) => x.id !== viewer.id && callName(x) === e.displayName);
          if (m && e.id) setLive((l) => [...l.filter((p) => p.pid !== e.id), { pid: e.id!, mid: m.id }]);
        });
        api.addListener("participantLeft", (e) => setLive((l) => l.filter((p) => p.pid !== e.id)));
        // The browser blocked the microphone or camera inside the room: never a blank room.
        api.addListener("micError", () => {
          setBlockedVideo(false);
          setPhase("denied");
        });
        api.addListener("cameraError", () => {
          setBlockedVideo(true);
          setPhase("denied");
        });
        api.addListener("readyToClose", () => void leave());
      } catch {
        setMode("iframe");
      }
    };
    if (window.JitsiMeetExternalAPI) start();
    else {
      const s = document.createElement("script");
      s.src = scriptFor(info);
      s.async = true;
      s.onload = start;
      s.onerror = () => !gone && setMode("iframe");
      document.head.appendChild(s);
    }
    return () => {
      gone = true;
      window.clearTimeout(fallback);
      dispose();
    };
    // The room is made once per join; the venue and members are read when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom, info, media]);

  // The host leaving closes the door; a guest leaving changes nothing for anyone else.
  async function leave() {
    dispose();
    if (knock?.memberId === viewer.id) await postJson("/api/sit", { action: "unknock" });
    router.replace("/");
  }

  // Seats fill in the order people arrived, you first. Before the room reports who is in
  // it (or in the plain iframe), the host and those who said they're coming stand in.
  const expected = knock ? [knock.memberId] : sitting ? [sitting.hostId, ...sitting.going] : [];
  const order = Array.from(new Set([viewer.id, ...(mode === "api" ? live.map((p) => p.mid) : expected)]));
  const sitters: Sitter[] = order.flatMap((mid) => {
    const m = members.find((x) => x.id === mid);
    return m ? [{ id: m.id, name: m.id === viewer.id ? "You" : callName(m), photo: memberPhoto(m), child: m.access === "child" || m.role === "child" }] : [];
  });
  const untilText = knock && now ? `until ${timeIn(viewer.tz, new Date(knock.until))}` : sitting && now ? `starts ${timeIn(viewer.tz, new Date(sitting.startsAt))}` : "";

  return (
    <div className="lite-ground fixed inset-0 z-40">
      <VenueScene venue={venue} sitters={sitters}>
        <div className="absolute inset-x-0 top-0 z-10">
          <header className="flex items-center gap-3 px-4" style={{ paddingTop: "calc(10px + env(safe-area-inset-top))" }}>
            <button type="button" onClick={() => (inRoom ? void leave() : router.replace("/"))} aria-label={inRoom ? "Leave" : "Back"} className="press grid h-11 w-11 place-items-center rounded-full bg-black/35 text-white">
              <Icon name="back" size={20} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="m-0 flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.1em] text-white/80">
                <Icon name="door" size={14} /> {phase === "in" ? (media === "audio" ? "Audio only" : "Sitting together") : "Open door"}
              </p>
              <h1 className="m-0 truncate text-title text-white">{title}</h1>
            </div>
          </header>
          <ul className="no-scrollbar m-0 flex list-none gap-2 overflow-x-auto px-4 pb-1 pt-2" aria-label="Family clocks">
            {members.map((m) => (
              <li key={m.id} className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/40 py-0.5 pl-0.5 pr-2.5 ring-1 ring-white/15">
                <Avatar src={memberPhoto(m)} name={callName(m)} size={22} />
                <span className="text-caption leading-tight text-white/85">
                  <span className="font-semibold">{m.id === viewer.id ? "You" : callName(m)}</span>
                  <span className="text-white/60" suppressHydrationWarning>
                    {" "}
                    {now ? timeIn(m.tz, now) : ""} · {m.city || placeFromTz(m.tz)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div
          data-ui="call-room"
          className="absolute inset-x-3 top-[27%] z-10 mx-auto max-w-[920px] overflow-hidden rounded-[28px] bg-black bg-cover bg-center p-2 shadow-[0_24px_60px_rgba(0,0,0,.55)] ring-1 ring-white/15"
          style={{ backgroundImage: `url(${venue.image})`, bottom: "calc(max(14%, 70px) + env(safe-area-inset-bottom) * 0.4)" }}
        >
          <div aria-live="polite" className="h-full w-full overflow-hidden rounded-[20px] bg-black">
            {phase === "checking" && <div className="grid h-full place-items-center text-white/70">Checking the door…</div>}

            {phase === "prejoin" && (
              <div data-ui="call-prejoin" className="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-4 text-center text-white">
                <Avatar src={memberPhoto(host)} name={callName(host)} size={56} />
                <p className="m-0 text-body font-semibold">{knock ? doorLine({ activity: knock.activity ?? null, note: knock.note }) : sitting?.note || venue.name}</p>
                {untilText && (
                  <p className="m-0 text-footnote text-white/70" suppressHydrationWarning>
                    {untilText}
                  </p>
                )}
                <p className="m-0 text-footnote text-white/70">Your microphone and camera stay off until you choose.</p>
                <div className="mt-1 grid w-full max-w-[320px] gap-2">
                  <button type="button" data-ui="join-audio" onClick={() => void join("audio")} className={`${BTN} bg-white text-black`}>
                    <Icon name="mic" size={19} /> Join with audio
                  </button>
                  <button type="button" data-ui="join-video" onClick={() => void join("video")} className={`${BTN} bg-white/15 text-white`}>
                    <Icon name="video" size={19} /> Join with video
                  </button>
                  <button type="button" onClick={() => router.replace("/")} className={`${BTN} text-white/80`}>
                    Not now
                  </button>
                </div>
              </div>
            )}

            {phase === "connecting" && <div className="grid h-full place-items-center text-white/70">Joining…</div>}

            {phase === "in" && mediaAllowed(phase) && info && media && (
              mode === "iframe" ? (
                <iframe
                  title="Family call"
                  src={`https://${info.domain}/${roomName(info)}${info.jwt ? `?jwt=${info.jwt}` : ""}#${jitsiHash(media, callName(viewer))}`}
                  allow={media === "audio" ? "microphone; autoplay" : "camera; microphone; fullscreen; autoplay"}
                  className="h-full w-full border-0"
                />
              ) : (
                <div ref={holder} className="h-full w-full" />
              )
            )}

            {phase === "denied" && (
              <div data-ui="call-denied" role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-white">
                <p className="m-0 text-body font-semibold">{blockedVideo ? "The browser blocked the camera or microphone" : "The browser blocked the microphone"}</p>
                <p className="m-0 text-footnote text-white/70">You can allow it in your browser&rsquo;s settings for this site, then try again.</p>
                <div className="grid w-full max-w-[320px] gap-2">
                  <button type="button" onClick={() => void join("audio")} className={`${BTN} bg-white text-black`}>
                    Try audio only
                  </button>
                  <button type="button" onClick={() => void leave()} className={`${BTN} text-white/80`}>
                    Leave
                  </button>
                </div>
              </div>
            )}

            {(phase === "closed" || phase === "ended") && (
              <div data-ui="call-closed" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-white">
                <p className="m-0 text-body font-semibold">{phase === "ended" && host && !isHost ? `${callName(host)} closed the door` : "This door has closed"}</p>
                <button type="button" onClick={() => router.replace("/")} className={`${BTN} max-w-[240px] bg-white text-black`}>
                  Back
                </button>
              </div>
            )}
          </div>
        </div>
      </VenueScene>
    </div>
  );
}
