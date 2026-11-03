"use client";

import { AnimatePresence, LazyMotion, m } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { markEntered } from "@/lib/entered";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { WaitingItem } from "@/lib/glance";
import { useJson } from "@/lib/use-json";
import { callName, peopleByRecency } from "@/lib/people";
import { useFamilyCards } from "@/lib/use-family";
import { useLargeText } from "@/lib/use-large-text";
import { roomHref, roomsFor } from "@/lib/menu";
import { canStartPortrait } from "@/lib/muse-portrait";
import { isKid } from "@/lib/kids";
import dynamic from "next/dynamic";
import type { AddTab, ReplyContribution } from "./add-sheet";

import { PlayerProvider, usePlayer } from "./player";
import { BottomSheet } from "./ui/bottom-sheet";
import { Icon, type IconName } from "./ui/kit";
import { HouseGlyph } from "./ui/glyphs";
import { ViewerProvider, useViewer } from "./viewer";
import { DocumentLangOnly } from "@/lib/use-t";
import { onAppUrlOpen, setStatusBar, watchPush } from "@/lib/native";
import { refreshSubscription } from "@/lib/web-push";

// The composer (mic, EXIF, media processing) loads only when first opened.
// Sheets nobody needs until they tap: fetched when first opened, then kept mounted so they can animate out.
const PeoplePicker = dynamic(() => import("./people-picker").then((x) => x.PeoplePicker), { ssr: false });
const InviteSheet = dynamic(() => import("./invite-sheet").then((x) => x.InviteSheet), { ssr: false });
const loadMotionFeatures = () => import("./motion-features").then((x) => x.default);

/** True from the first time `flag` is true, for good. */
function useEver(flag: boolean): boolean {
  const [ever, setEver] = useState(flag);
  if (flag && !ever) setEver(true);
  return ever || flag;
}

const AddSheet = dynamic(() => import("./add-sheet").then((m) => m.AddSheet), { ssr: false });

interface ShellState {
  addOpen: boolean;
  addTab: AddTab;
  replyTo: ReplyContribution | null;
  /** Member a voice note is addressed to; null = whole family. */
  /** Preselected recipients: one person, a household, or none (everyone). */
  addressee: string[] | null;
  openAdd: (tab?: AddTab, replyTo?: ReplyContribution | null, addressee?: string | string[] | null) => void;
  closeAdd: () => void;
  refreshKey: number;
  bumpRefresh: () => void;
  chromeHidden: boolean;
  setChromeHidden: (v: boolean) => void;
  /**
   * On "/" the dock is OFF unless the page turns it on (app/page.tsx, for the courtyard and
   * kid gates only). It is remembered per path, so leaving "/" and coming back starts off again.
   */
  dockOn: boolean;
  setDockOn: (v: boolean) => void;
  /** Open the rooms sheet (the five rooms of the house). */
  openRooms: () => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside Shell");
  return ctx;
}


/** The rooms of the house: five tiles, nothing nested. A tile opens the room on its first page; inside, the tab row moves sideways. */
function RoomsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { viewer, members } = useViewer();
  const all = roomsFor(viewer.role === "elder", canStartPortrait(viewer), isKid(viewer), members.some((m) => isKid(m)));
  return (
    <BottomSheet open={open} onClose={onClose} title="The house" dataUi="house-sheet" z={50}>
      {/* Settings live behind your own photo only, not here. */}
      <ul className="m-0 list-none space-y-1.5 p-0">
        {all.map((g) => (
          <li key={g.id}>
            <Link href={roomHref(g)} onClick={onClose} data-room={g.id} className="press flex w-full items-center gap-3.5 rounded-tile bg-surface px-4 py-3 text-left text-ink no-underline" style={{ boxShadow: "var(--surface-edge)" }}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-well">
                <Icon name={g.icon as IconName} size={20} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold leading-tight">{g.title}</span>
                <span className="mt-0.5 block truncate text-footnote text-ink-soft">{g.note}</span>
              </span>
              <Icon name="chevron" size={17} className="text-ink-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}

// The dock: two buttons. Voice is the one big action (a voice note to anyone; a dot says someone
// is waiting for your reply) and the house opens the rooms (Living Room, Memories, Kitchen, Our People, Care).
// Photos are one tap inside the voice sheet ("Add a photo instead"); For you is behind your own photo.
function Dock() {
  const { openAdd, openRooms, refreshKey, chromeHidden, dockOn } = useShell();
  const { viewer, members } = useViewer();
  const { current, open: playerOpen } = usePlayer();
  const pathname = usePathname();
  // The dock only needs the family's cards (who to talk to first) once it is on screen:
  // the window, its first screen, never pays for the full card list.
  const hasDock = (pathname === "/" && dockOn) || pathname.startsWith("/people/");
  const show = hasDock && !chromeHidden && !playerOpen;
  const { cards } = useFamilyCards(refreshKey, show);
  const [picking, setPicking] = useState(false);
  const [inviting, setInviting] = useState(false);
  const pickerEver = useEver(picking);
  const inviteEver = useEver(inviting);

  const pagePerson = pathname.startsWith("/people/") ? members.find((mm) => mm.id === pathname.split("/")[2]) : undefined;
  // What waits for you: the same list as the window's "Waiting for you" tile (GET /api/waiting),
  // so the dot goes when the thing is played, answered or opened. Who is waiting shows in the picker.
  const { data: wait, reload: reloadWaiting } = useJson<{ items: WaitingItem[] }>(hasDock ? "/api/waiting" : null, { every: 120_000 });
  useEffect(() => {
    if (refreshKey) void reloadWaiting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  const waitingList = wait?.items ?? [];
  const waiting = useMemo(() => new Set((wait?.items ?? []).flatMap((i) => (i.fromId ? [i.fromId] : []))), [wait]);
  const others = useMemo(() => peopleByRecency(viewer.id, members, cards ?? []).sort((a, b) => Number(waiting.has(b.id)) - Number(waiting.has(a.id)) || Number(a.role === "child") - Number(b.role === "child")), [viewer.id, members, cards, waiting]);
  const voice = () => {
    if (pagePerson && pagePerson.id !== viewer.id) return openAdd("voice", null, [pagePerson.id]);
    if (others.length === 1) return openAdd("voice", null, [others[0].id]);
    setPicking(true);
  };

  return (
    <>
      <AnimatePresence>
        {show && (
          <m.div
            className="fixed inset-x-0 z-40 flex justify-center px-4"
            style={{ bottom: `calc(${current ? 84 : 20}px + env(safe-area-inset-bottom))` }}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <div data-ui="dock" className="frost glass-pill flex items-center gap-2 p-1.5">
              {others.length ? (
                <button type="button" onClick={voice} aria-label={`Voice memory${pagePerson && pagePerson.id !== viewer.id ? ` to ${callName(pagePerson)}` : ""}${waitingList.length ? `, ${waitingList.length} waiting for your reply` : ""}`} className="press relative flex h-14 items-center justify-center gap-2 rounded-full bg-accent px-7 text-accent-ink">
                  <Icon name="mic" size={25} strokeWidth={1.9} />
                  <span className="text-headline font-semibold">Voice</span>
                  {waitingList.length > 0 && <span className="absolute right-2 top-2 h-3 w-3 rounded-full bg-[var(--waiting)] ring-2 ring-white" aria-hidden="true" />}
                </button>
              ) : (
                <button type="button" onClick={() => setInviting(true)} aria-label="Invite family" className="press grid h-12 w-12 place-items-center rounded-full bg-accent text-accent-ink">
                  <Icon name="plus" size={23} />
                </button>
              )}
              <button type="button" onClick={openRooms} aria-label="Open the house" className="press grid h-12 w-12 place-items-center rounded-full text-ink">
                <HouseGlyph size={26} />
              </button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
      {pickerEver && (
        <PeoplePicker
          open={picking}
          people={others}
          waitingIds={waiting}
          onPick={(ids) => {
            setPicking(false);
            openAdd("voice", null, ids.length === others.length ? null : ids);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {inviteEver && <InviteSheet open={inviting} onClose={() => setInviting(false)} />}
    </>
  );
}

/**
 * Being in Nearer is the "safe & sound" signal the other home sees (green
 * dot). Sent on open and whenever the app comes back to the foreground; the
 * server keeps at most one every 30 minutes and skips people who opted out.
 */
function useHeartbeat(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const beat = () => {
      if (document.visibilityState === "visible") void fetch("/api/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ moment: "here" }) }).catch(() => undefined);
    };
    beat();
    document.addEventListener("visibilitychange", beat);
    return () => document.removeEventListener("visibilitychange", beat);
  }, [on]);
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { viewer, signedIn } = useViewer();
  useHeartbeat(signedIn);
  // Any app route counts as stepping inside: "/" on a laptop is then the app, not the site.
  const herePath = usePathname();
  useEffect(() => {
    if (herePath !== "/" && herePath !== "/home") markEntered();
  }, [herePath]);
  // Native app: status bar style, and deep links (auth callback, shared links) open in-app.
  const nativeRouter = useRouter();
  useEffect(() => {
    void setStatusBar();
    return onAppUrlOpen((route) => nativeRouter.push(route));
  }, [nativeRouter]);
  // Push: in the app, keep this phone's token fresh and open the page a tapped notification names;
  // on the web, re-save the browser's subscription if the person already said yes. Never asks.
  useEffect(() => {
    if (!signedIn) return;
    void refreshSubscription();
    return watchPush((route) => nativeRouter.push(route));
  }, [signedIn, nativeRouter]);
  const [large] = useLargeText(viewer.role === "elder");
  const [addOpen, setAddOpen] = useState(false);
  // Mount the composer on first open, then keep it mounted so its exit animation runs.
  const [sheetLoaded, setSheetLoaded] = useState(false);
  useEffect(() => {
    if (addOpen) setSheetLoaded(true);
  }, [addOpen]);
  const [addTab, setAddTab] = useState<AddTab>("photos");
  const [replyTo, setReplyTo] = useState<ReplyContribution | null>(null);
  const [addressee, setAddressee] = useState<string[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [chromeHidden, setChromeHidden] = useState(false);
  // The path that asked for the dock; it counts only while we are still on that path.
  const path = usePathname();
  const [dockPath, setDockPath] = useState<string | null>(null);
  const dockOn = dockPath === path;
  const setDockOn = useCallback((v: boolean) => setDockPath(v ? window.location.pathname : null), []);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const openRooms = useCallback(() => setRoomsOpen(true), []);
  const closeRooms = useCallback(() => setRoomsOpen(false), []);

  const openAdd = useCallback((tab: AddTab = "photos", contribution: ReplyContribution | null = null, to: string | string[] | null = null) => {
    setAddTab(tab);
    setReplyTo(contribution);
    setAddressee(to === null ? null : Array.isArray(to) ? to : [to]);
    setAddOpen(true);
  }, []);
  const closeAdd = useCallback(() => {
    setAddOpen(false);
    setReplyTo(null);
  }, []);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const value = useMemo<ShellState>(
    () => ({ addOpen, addTab, replyTo, addressee, openAdd, closeAdd, refreshKey, bumpRefresh, chromeHidden, setChromeHidden, dockOn, setDockOn, openRooms }),
    [addOpen, addTab, replyTo, addressee, openAdd, closeAdd, refreshKey, bumpRefresh, chromeHidden, dockOn, setDockOn, openRooms],
  );

  return (
    <ShellContext.Provider value={value}>
      <PlayerProvider>
        <main
          className="relative mx-auto min-h-full w-full max-w-[480px] px-4"
          style={{ paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(172px + env(safe-area-inset-bottom))", zoom: large ? 1.12 : undefined }}
        >
          {children}
        </main>
        {signedIn && <DocumentLangOnly />}
        <Dock />
        <RoomsSheet open={roomsOpen} onClose={closeRooms} />
        {sheetLoaded && <AddSheet />}
      </PlayerProvider>
    </ShellContext.Provider>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadMotionFeatures} strict={false}>
      <ViewerProvider>
        <ShellInner>{children}</ShellInner>
      </ViewerProvider>
    </LazyMotion>
  );
}
