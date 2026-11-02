"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_VIEWER_ID, DEMO_FAMILY, DEMO_MEMBERS, signalLineFor } from "@/lib/family";
import { normalizeDisplayLang, type SupportedLang } from "@/lib/i18n";
import type { Member, Relationship } from "@/lib/schemas";
import { fetchFirst } from "@/lib/early";
import { prefetchJson } from "@/lib/use-json";
import { Waiting } from "@/components/waiting";

interface ViewerState {
  /** True once the session and family have loaded (or there is no session). */
  ready: boolean;
  signedIn: boolean;
  /** Joined, but an owner/admin hasn't let them in yet (whom they wait for). */
  waiting: { hostName: string | null } | null;
  viewer: Member;
  members: Member[];
  /** How everyone is related (households, the tree, the dock). */
  relationships: Relationship[];
  lang: SupportedLang;
  displayLang: SupportedLang;
  signalLine: string;
  setViewerId: (id: string) => Promise<void>;
  setDisplayLang: (lang: SupportedLang) => Promise<void>;
  refreshMembers: () => Promise<void>;
}

const ViewerContext = createContext<ViewerState | null>(null);

const fallbackViewer = (): Member =>
  DEMO_MEMBERS.find((m) => m.id === DEFAULT_VIEWER_ID) ?? DEMO_MEMBERS[0];

async function fetchRelationships(): Promise<Relationship[]> {
  const res = await fetch("/api/relationships", { cache: "no-store" });
  if (!res.ok) return [];
  return ((await res.json()) as { relationships: Relationship[] }).relationships;
}

interface SessionAnswer {
  memberId: string;
  status?: "active" | "pending";
  waitingFor?: string | null;
  /** With ?family=1, for an active member: the family (as /api/members) and how everyone is related. */
  members?: Member[];
  relationships?: Relationship[];
}

/** Who am I, with my family and its relationships: one request (GET /api/session?family=1). Null when signed out. */
async function fetchSessionWithFamily(): Promise<SessionAnswer | null> {
  const res = await fetchFirst("/api/session?family=1");
  // Only a real "no session" signs someone out; a host hiccup (5xx) must not.
  if (res.status >= 500) throw new Error(`session-${res.status}`);
  if (!res.ok) return null;
  return (await res.json()) as SessionAnswer;
}

// Remembered so other screens can tell a returning, signed-in visitor (never the session itself).
const SIGNED_KEY = "aangan:signed";
const rememberSignedIn = (on: boolean): void => {
  try {
    if (on) localStorage.setItem(SIGNED_KEY, "1");
    else localStorage.removeItem(SIGNED_KEY);
  } catch {
    /* no storage */
  }
};

export function ViewerProvider({ children }: { children: React.ReactNode }) {
  const [members, setMembers] = useState<Member[]>(DEMO_MEMBERS);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [viewerId, setViewerIdState] = useState<string>(DEFAULT_VIEWER_ID);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [waiting, setWaiting] = useState<{ hostName: string | null } | null>(null);

  // Viewer switcher keeps the httpOnly session in sync: the server mints a
  // fresh cookie for the same family (no invite code needed twice).
  const setViewerId = useCallback(async (id: string) => {
    try {
      await fetch("/api/session/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId: id }),
      });
    } catch {
      // Offline: local state still switches.
    }
    setViewerIdState(id);
    // Another person's session: nothing cached for the last one may paint.
    window.dispatchEvent(new Event("aangan:auth"));
  }, []);

  const refreshMembers = useCallback(async () => {
    try {
      const s = await fetchSessionWithFamily();
      if (!s?.members) throw new Error("members-fetch-failed");
      if (s.members.length > 0) setMembers(s.members);
      setRelationships(s.relationships ?? (await fetchRelationships().catch(() => [] as Relationship[])));
    } catch {
      // Offline or server hiccup: keep the seeded demo members.
    }
  }, []);

  // The viewer is whoever the session cookie says, never a hard-coded member.
  // A second sync (a switch while one is still answering) wins; the older answer is dropped.
  const syncSeq = useRef(0);
  const hiccups = useRef(0);
  const syncSessionRef = useRef<(() => Promise<void>) | null>(null);
  const syncSession = useCallback(async () => {
    const seq = ++syncSeq.current;
    try {
      // The session, the family and its relationships in one request; on the first screen it was
      // started by the page's inline script before this code loaded (lib/early.ts).
      const s = await fetchSessionWithFamily();
      if (seq !== syncSeq.current) return;
      hiccups.current = 0;
      if (s) {
        if (s.status === "pending") {
          // Every other API is shut until an admin lets them in.
          setViewerIdState(s.memberId);
          setWaiting({ hostName: s.waitingFor ?? null });
          setSignedIn(true);
          rememberSignedIn(true);
          return;
        }
        setWaiting(null);
        // The window's payload, if the inline script didn't start it already (lib/use-json.ts takes the early one).
        if (window.location.pathname === "/") prefetchJson("/api/window");
        if (s.members && s.members.length > 0) setMembers(s.members);
        setRelationships(s.relationships ?? []);
        setViewerIdState(s.memberId);
        setSignedIn(true);
        rememberSignedIn(true);
      } else {
        setSignedIn(false);
        setWaiting(null);
        rememberSignedIn(false);
      }
    } catch (err) {
      if (seq !== syncSeq.current) return;
      // A host hiccup is not a sign-out: try again shortly (twice), keeping whoever was signed in.
      if (err instanceof Error && err.message.startsWith("session-5") && hiccups.current < 2) {
        hiccups.current += 1;
        setTimeout(() => void syncSessionRef.current?.(), 1500);
        return;
      }
      setSignedIn(false);
    } finally {
      if (seq === syncSeq.current) setReady(true);
    }
  }, []);
  syncSessionRef.current = syncSession;

  useEffect(() => {
    void syncSession();
    const onAuth = () => void syncSession();
    window.addEventListener("aangan:auth", onAuth);
    return () => window.removeEventListener("aangan:auth", onAuth);
  }, [syncSession]);

  const setDisplayLang = useCallback(
    async (lang: SupportedLang) => {
      const normalized = normalizeDisplayLang(lang);
      setMembers((prev) => prev.map((m) => (m.id === viewerId ? { ...m, displayLang: normalized } : m)));
      try {
        await fetch("/api/members/display-lang", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ memberId: viewerId, displayLang: normalized }),
        });
      } catch {
        // Offline: local state already updated.
      }
      await refreshMembers().catch(() => undefined);
    },
    [viewerId, refreshMembers],
  );

  const value = useMemo<ViewerState>(() => {
    const viewer = members.find((m) => m.id === viewerId) ?? fallbackViewer();
    const displayLang = normalizeDisplayLang(viewer.displayLang ?? viewer.lang);
    return {
      ready,
      signedIn,
      waiting,
      viewer,
      members,
      relationships,
      lang: displayLang,
      displayLang,
      signalLine: signalLineFor(viewer.id, displayLang),
      setViewerId,
      setDisplayLang,
      refreshMembers,
    };
  }, [members, relationships, viewerId, ready, signedIn, waiting, refreshMembers, setDisplayLang, setViewerId]);

  // The gate for joiners who are still waiting: one calm screen, app-wide.
  return <ViewerContext.Provider value={value}>{waiting ? <Waiting hostName={waiting.hostName} onCheck={syncSession} /> : children}</ViewerContext.Provider>;
}

export function useViewer(): ViewerState {
  const ctx = useContext(ViewerContext);
  if (!ctx) throw new Error("useViewer must be used inside ViewerProvider");
  return ctx;
}

export { DEMO_FAMILY };
