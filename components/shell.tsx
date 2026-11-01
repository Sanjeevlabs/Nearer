"use client";

import { AnimatePresence, LazyMotion, m } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { markEntered } from "@/lib/entered";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { talkTarget } from "@/lib/households";
import { callName, peopleByRecency } from "@/lib/people";
import { useFamilyCards } from "@/lib/use-family";
import { useLargeText } from "@/lib/use-large-text";
import { roomHref, roomsFor } from "@/lib/menu";
import { canStartPortrait } from "@/lib/muse-portrait";
import dynamic from "next/dynamic";
import type { AddTab, ReplyContribution } from "./add-sheet";

import { PlayerProvider, usePlayer } from "./player";
import { Icon, type IconName } from "./ui/kit";
import { ViewerProvider, useViewer } from "./viewer";
import { DocumentLangOnly } from "@/lib/use-t";
import { onAppUrlOpen, setStatusBar } from "@/lib/native";

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
  const { viewer } = useViewer();
  const all = roomsFor(viewer.role === "elder", canStartPortrait(viewer));
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="The house">
          <m.button type="button" aria-label="Close" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <m.nav
            aria-label="The house"
            className="frost relative w-full max-w-[480px] overflow-y-auto rounded-t-[32px] px-4 pt-3"
            style={{ maxHeight: "88vh", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-black/15" aria-hidden="true" />
            {/* Settings live behind your own photo only, not here. */}
            <ul className="m-0 list-none space-y-1.5 p-0">
              {all.map((g) => (
                <li key={g.id}>
                  <Link href={roomHref(g)} onClick={onClose} data-room={g.id} className="press flex w-full items-center gap-3.5 rounded-[20px] bg-white/80 px-3.5 py-3 text-left text-ink no-underline ring-1 ring-black/[.05]">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/[.05]">
                      <Icon name={g.icon as IconName} size={20} strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[16.5px] font-semibold leading-tight">{g.title}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-ink-soft">{g.note}</span>
                    </span>
                    <Icon name="chevron" size={17} className="text-ink-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          </m.nav>
        </div>
      )}
    </AnimatePresence>
  );
}

// The dock: a voice note (to anyone; it says who is waiting for your reply),
// a photo, and the house for the rooms (Memories, Kitchen, Care, Family, Celebrations).
function Dock() {
  const { openAdd, openRooms, refreshKey, chromeHidden } = useShell();
  const { viewer, members, relationships } = useViewer();
  const { cards } = useFamilyCards(refreshKey);
  const { current, open: playerOpen } = usePlayer();
  const pathname = usePathname();
  const [picking, setPicking] = useState(false);
  const [inviting, setInviting] = useState(false);
  const pickerEver = useEver(picking);
  const inviteEver = useEver(inviting);

  const pagePerson = pathname.startsWith("/people/") ? members.find((mm) => mm.id === pathname.split("/")[2]) : undefined;
  // Who sent you a voice you haven't answered: shown in the picker, never assumed.
  const waiting = useMemo(() => {
    const t = talkTarget(viewer, members, relationships, cards ?? []);
    return new Set(t?.reason === "reply" ? t.home.members.map((m) => m.id) : []);
  }, [viewer, members, relationships, cards]);
  const others = useMemo(() => peopleByRecency(viewer.id, members, cards ?? []).sort((a, b) => Number(waiting.has(b.id)) - Number(waiting.has(a.id)) || Number(a.role === "child") - Number(b.role === "child")), [viewer.id, members, cards, waiting]);
  const show = (pathname === "/" || pathname.startsWith("/people/")) && !chromeHidden && !playerOpen;
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
            <div className="frost glass-pill flex items-center gap-1 p-1.5">
              {others.length ? (
                <button type="button" onClick={voice} aria-label={pagePerson && pagePerson.id !== viewer.id ? `Voice note to ${callName(pagePerson)}` : "Voice note"} className="press relative grid h-14 w-14 place-items-center rounded-full bg-black text-white">
                  <Icon name="mic" size={23} strokeWidth={1.9} />
                  {waiting.size > 0 && !pagePerson && (
                    <span className="absolute right-0 top-0 h-3 w-3 rounded-full bg-marigold ring-2 ring-white" role="img" aria-label="Someone is waiting to hear from you" />
                  )}
                </button>
              ) : (
                <button type="button" onClick={() => setInviting(true)} aria-label="Invite family" className="press grid h-14 w-14 place-items-center rounded-full bg-black text-white">
                  <Icon name="plus" size={23} />
                </button>
              )}
              <button type="button" onClick={() => openAdd("photos")} aria-label="Share a photo or video" className="press grid h-14 w-14 place-items-center rounded-full text-ink">
                <Icon name="camera" size={23} strokeWidth={1.9} />
              </button>
              <button type="button" onClick={openRooms} aria-label="Open the house" className="press grid h-14 w-14 place-items-center rounded-full text-ink">
                <Icon name="rooms" size={23} strokeWidth={1.9} />
              </button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
      {pickerEver && (
        <PeoplePicker
          open={picking}
          title="Voice note to"
          people={others}
          everyoneLabel="The whole family"
          status={(p) => (waiting.has(p.id) ? { text: "Waiting for your reply", dot: "#e8402a" } : { text: p.city || "" })}
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
 * Being in Aangan is the "safe & sound" signal the other home sees (green
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
    () => ({ addOpen, addTab, replyTo, addressee, openAdd, closeAdd, refreshKey, bumpRefresh, chromeHidden, setChromeHidden, openRooms }),
    [addOpen, addTab, replyTo, addressee, openAdd, closeAdd, refreshKey, bumpRefresh, chromeHidden, openRooms],
  );

  return (
    <ShellContext.Provider value={value}>
      <PlayerProvider>
        <main
          className="relative mx-auto min-h-full w-full max-w-[480px] px-5"
          style={{ paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(140px + env(safe-area-inset-bottom))", zoom: large ? 1.12 : undefined }}
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
