"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar, Icon } from "@/components/ui/kit";
import { useShell } from "@/components/shell";
import { VenueScene, type Sitter } from "@/components/venue-scene";
import { useViewer } from "@/components/viewer";
import type { Knock, Sitting } from "@/lib/kinds";
import { roomUrl } from "@/lib/overlap";
import { callName, memberPhoto } from "@/lib/people";
import { postJson, useJson } from "@/lib/use-json";
import { venueOf } from "@/lib/venues";
import { placeFromTz, timeIn } from "@/lib/zones";

// Sitting together, inside Aangan: a venue (courtyard, terrace...) with the
// family on their seats, and the video room as the table in the middle. Only a
// knock or sitting of this family opens a room; its name is the random id,
// never a guessable family name.

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

const JITSI_SCRIPT = "https://meet.jit.si/external_api.js";

/** The venue photo as a data URL (the call's background must not taint its canvas); the plain URL if that fails. */
async function backgroundFor(path: string): Promise<string> {
  const url = new URL(path, window.location.origin).href;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise<string>((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => no(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

/** Elders' phones: fewer cores or little memory means no virtual background by default. */
function lowEndDevice(): boolean {
  const n = navigator as Navigator & { deviceMemory?: number };
  return (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 4;
}

export default function CallPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { setChromeHidden } = useShell();
  const { viewer, members } = useViewer();
  const { data } = useJson<{ sittings: Sitting[]; knocks: Knock[] }>("/api/sit");
  const [now, setNow] = useState<Date | null>(null);
  const [mode, setMode] = useState<"loading" | "api" | "iframe">("loading");
  const [bg, setBg] = useState(true);
  const [live, setLive] = useState<{ pid: string; mid: string }[]>([]);
  const holder = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiApi | null>(null);
  const bgRef = useRef(true);
  useEffect(() => {
    setChromeHidden(true);
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      clearInterval(t);
      setChromeHidden(false);
    };
  }, [setChromeHidden]);
  useEffect(() => {
    const on = !lowEndDevice();
    bgRef.current = on;
    setBg(on);
  }, []);

  const knock = data?.knocks.find((k) => k.id === id);
  const sitting = data?.sittings.find((s) => s.id === id);
  const valid = Boolean(knock || sitting);
  const venue = venueOf((knock ?? sitting)?.venue);
  const title = sitting?.title ?? (knock ? `${callName(members.find((m) => m.id === knock.memberId))}'s ${venue.name.toLowerCase()}` : "Sitting together");

  // The video room: Jitsi's IFrame API so everyone gets the venue as a background;
  // the plain iframe if the script is slow (6 s) or fails.
  useEffect(() => {
    if (!valid) return;
    let gone = false;
    const fallback = window.setTimeout(() => !gone && !apiRef.current && setMode("iframe"), 6000);
    const start = () => {
      if (gone || !holder.current || !window.JitsiMeetExternalAPI) return;
      try {
        const api = new window.JitsiMeetExternalAPI("meet.jit.si", {
          roomName: roomUrl(id).split("/").pop(),
          parentNode: holder.current,
          width: "100%",
          height: "100%",
          userInfo: { displayName: callName(viewer) },
          configOverwrite: { prejoinConfig: { enabled: false }, startWithAudioMuted: false, disableDeepLinking: true },
          interfaceConfigOverwrite: { TOOLBAR_BUTTONS: ["microphone", "camera", "tileview", "fullscreen", "hangup"], SHOW_JITSI_WATERMARK: false, SHOW_BRAND_WATERMARK: false, MOBILE_APP_PROMO: false },
        });
        apiRef.current = api;
        window.clearTimeout(fallback);
        setMode("api");
        api.addListener("videoConferenceJoined", () => {
          if (!bgRef.current) return;
          backgroundFor(venue.image)
            .then((img) => api.executeCommand("setVirtualBackground", true, img))
            .catch(() => undefined);
        });
        api.addListener("participantJoined", (e) => {
          const m = members.find((x) => x.id !== viewer.id && callName(x) === e.displayName);
          if (m && e.id) setLive((l) => [...l.filter((p) => p.pid !== e.id), { pid: e.id!, mid: m.id }]);
        });
        api.addListener("participantLeft", (e) => setLive((l) => l.filter((p) => p.pid !== e.id)));
        api.addListener("readyToClose", () => void leave());
      } catch {
        setMode("iframe");
      }
    };
    if (window.JitsiMeetExternalAPI) start();
    else {
      const s = document.createElement("script");
      s.src = JITSI_SCRIPT;
      s.async = true;
      s.onload = start;
      s.onerror = () => !gone && setMode("iframe");
      document.head.appendChild(s);
    }
    return () => {
      gone = true;
      window.clearTimeout(fallback);
      try {
        apiRef.current?.dispose();
      } catch {
        /* already gone */
      }
      apiRef.current = null;
    };
    // The room is made once per sitting; the venue and members are read when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, id]);

  const toggleBg = () => {
    const next = !bg;
    bgRef.current = next;
    setBg(next);
    try {
      if (!next) apiRef.current?.executeCommand("setVirtualBackground", false);
      else void backgroundFor(venue.image).then((img) => apiRef.current?.executeCommand("setVirtualBackground", true, img));
    } catch {
      /* the call carries on without it */
    }
  };

  const leave = async () => {
    if (knock?.memberId === viewer.id) await postJson("/api/sit", { action: "unknock" });
    router.replace("/");
  };

  // Seats fill in the order people arrived, you first. Before the room reports who is in
  // it (or in the plain iframe), the host and those who said they're coming stand in.
  const expected = knock ? [knock.memberId] : sitting ? [sitting.hostId, ...sitting.going] : [];
  const order = Array.from(new Set([viewer.id, ...(mode === "api" ? live.map((p) => p.mid) : expected)]));
  const sitters: Sitter[] = order.flatMap((mid) => {
    const m = members.find((x) => x.id === mid);
    return m ? [{ id: m.id, name: m.id === viewer.id ? "You" : callName(m), photo: memberPhoto(m), child: m.access === "child" || m.role === "child" }] : [];
  });

  return (
    <div className="lite-ground fixed inset-0 z-40">
      <VenueScene venue={venue} sitters={sitters}>
        <div className="absolute inset-x-0 top-0 z-10">
          <header className="flex items-center gap-3 px-4" style={{ paddingTop: "calc(10px + env(safe-area-inset-top))" }}>
            <button type="button" onClick={() => void leave()} aria-label="Leave" className="press grid h-11 w-11 place-items-center rounded-full bg-black/35 text-white">
              <Icon name="back" size={20} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="m-0 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#7be3a6]">
                <span className="h-2 w-2 rounded-full bg-[#7be3a6]" /> Sitting together
              </p>
              <h1 className="m-0 truncate text-[19px] text-white">{title}</h1>
            </div>
          </header>
          <ul className="no-scrollbar m-0 flex list-none gap-2 overflow-x-auto px-4 pb-1 pt-2" aria-label="Family clocks">
            {members.map((m) => (
              <li key={m.id} className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/40 py-0.5 pl-0.5 pr-2.5 ring-1 ring-white/15">
                <Avatar src={memberPhoto(m)} name={callName(m)} size={22} />
                <span className="text-[11.5px] leading-tight text-white/85">
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
          className="absolute inset-x-3 top-[27%] z-10 mx-auto max-w-[920px] overflow-hidden rounded-[28px] bg-black shadow-[0_24px_60px_rgba(0,0,0,.55)] ring-1 ring-white/15"
          style={{ bottom: "calc(max(14%, 70px) + env(safe-area-inset-bottom) * 0.4)" }}
        >
          {data === null ? (
            <div className="grid h-full place-items-center text-white/60">Opening the room…</div>
          ) : valid ? (
            mode === "iframe" ? (
              <iframe
                title="Family video call"
                src={`${roomUrl(id)}#config.prejoinConfig.enabled=false&userInfo.displayName=%22${encodeURIComponent(callName(viewer))}%22`}
                allow="camera; microphone; fullscreen; display-capture; autoplay"
                className="h-full w-full border-0"
              />
            ) : (
              <div ref={holder} className="h-full w-full" />
            )
          ) : (
            <div className="grid h-full place-items-center px-8 text-center text-white/70">This sitting has ended. Start a new one from the courtyard.</div>
          )}
          {valid && (
            <a href={roomUrl(id)} target="_blank" rel="noreferrer" className="glass-dark absolute right-3 top-3 flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-white no-underline">
              Open in browser
            </a>
          )}
          {valid && mode === "api" && (
            <button type="button" onClick={toggleBg} aria-pressed={bg} className="glass-dark press absolute left-3 top-3 flex h-9 items-center rounded-full px-3 text-[12.5px] font-semibold text-white">
              Background: {bg ? "on" : "off"}
            </button>
          )}
        </div>
      </VenueScene>
    </div>
  );
}
