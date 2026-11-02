"use client";

import * as L from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { roomOf, tabsFor } from "@/lib/spaces";
import { canStartPortrait } from "@/lib/muse-portrait";
import { isKid } from "@/lib/kids";
import { useViewer } from "@/components/viewer";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- icons */
// Lucide: one stroke family on a 24px grid, rounded joins. Names stay ours so
// screens never import an icon set directly; play/pause/stop stay solid.
const ICONS = {
  play: L.Play,
  pause: L.Pause,
  stop: L.Square,
  mic: L.Mic,
  camera: L.Camera,
  image: L.Image,
  more: L.Ellipsis,
  back: L.ChevronLeft,
  down: L.ChevronDown,
  chevron: L.ChevronRight,
  close: L.X,
  heart: L.Heart,
  laugh: L.Laugh,
  bless: L.HandHeart,
  reply: L.Reply,
  lane: L.GalleryVerticalEnd,
  calendar: L.CalendarHeart,
  gather: L.Users,
  tree: L.Network,
  settings: L.Settings,
  plus: L.Plus,
  check: L.Check,
  send: L.Send,
  pot: L.CookingPot,
  care: L.HeartHandshake,
  village: L.House,
  rooms: L.House,
  sparkle: L.Sparkles,
  door: L.DoorOpen,
  doorClosed: L.DoorClosed,
  key: L.KeyRound,
  sun: L.Sun,
  moon: L.Moon,
  cloud: L.Cloud,
  rain: L.CloudRain,
  storm: L.CloudLightning,
  fog: L.CloudFog,
  snow: L.Snowflake,
  phone: L.Phone,
  video: L.Video,
  shield: L.ShieldCheck,
  book: L.BookOpen,
  memories: L.Images,
  lamp: L.Lamp,
  music: L.Music2,
  pin: L.MapPin,
  wand: L.WandSparkles,
  coffee: L.Coffee,
  walk: L.Footprints,
  grid: L.LayoutGrid,
  flower: L.Flower2,
  briefcase: L.BriefcaseBusiness,
  car: L.Car,
  school: L.GraduationCap,
  lockOpen: L.LockKeyholeOpen,
  share: L.Share2,
  download: L.Download,
  link: L.Link,
  sticker: L.Sticker,
  whatsapp: L.MessageCircle,
  pickUp: L.HandHelping,
  edit: L.Pencil,
  trash: L.Trash2,
  up: L.ChevronUp,
  assign: L.UserPlus,
  contacts: L.Contact,
  gift: L.Gift,
  cake: L.Cake,
  pill: L.Pill,
  basket: L.ShoppingBasket,
  store: L.Store,
  external: L.ExternalLink,
  plug: L.Plug,
  wrench: L.Wrench,
  utensils: L.UtensilsCrossed,
  bell: L.Bell,
  info: L.Info,
  question: L.CircleHelp,
  star: L.Star,
  textSize: L.ALargeSmall,
  search: L.Search,
} satisfies Record<string, L.LucideIcon>;

export type IconName = keyof typeof ICONS;
const SOLID = new Set<IconName>(["play", "pause", "stop"]);

export function Icon({ name, size = 22, className, strokeWidth = 2, solid }: { name: IconName; size?: number; className?: string; strokeWidth?: number; solid?: boolean }) {
  const C = ICONS[name];
  return <C size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" fill={(solid ?? SOLID.has(name)) ? "currentColor" : "none"} />;
}

/* ---------------------------------------------------------------- photo */
// next/image for bundled demo art (served as-is: see next.config.mjs); plain passthrough for
// signed/session URLs that the optimiser can't fetch.

/** The bundled demo photos come in small WebP widths too (scripts/demo-variants.mjs). */
function demoWidths(src: string): number[] | null {
  if (/^\/demo\/home-(courtyard|balcony|window)\.jpg$/.test(src)) return [390, 780];
  if (/^\/demo\/venues\/[a-z]+\.jpg$/.test(src)) return [390, 780, 1600];
  if (/^\/demo\/family-[a-z]+\.webp$/.test(src)) return [440, 880];
  if (/^\/demo\/lamp-(lit|unlit)\.jpg$/.test(src)) return [160, 390];
  if (/^\/demo\/portrait-[a-z]+\.webp$/.test(src)) return [160, 400];
  return null;
}

export function Photo({
  src,
  alt = "",
  sizes = "100vw",
  priority = false,
  className,
  position = "center",
}: {
  src: string;
  alt?: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  position?: string;
}) {
  const widths = demoWidths(src);
  if (widths) {
    const at = (w: number) => src.replace(/\.(jpg|webp)$/, `-${w}.webp`);
    // Static assets with no optimiser behind them: the browser picks the width from srcset.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={at(widths[0])}
        srcSet={widths.map((w) => `${at(w)} ${w}w`).join(", ")}
        sizes={sizes}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : undefined}
        className={cn("absolute inset-0 h-full w-full object-cover", className)}
        style={{ objectPosition: position }}
      />
    );
  }
  const optimisable = src.startsWith("/demo/") && !src.endsWith(".svg");
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      unoptimized={!optimisable}
      className={cn("object-cover", className)}
      style={{ objectPosition: position }}
    />
  );
}

/* --------------------------------------------------------------- wave */
export function Wave({
  peaks,
  progress = 0,
  bars = 34,
  height = 30,
  color = "#fff",
  dim = "rgba(255,255,255,.4)",
  className,
}: {
  peaks: number[];
  progress?: number;
  bars?: number;
  height?: number;
  color?: string;
  dim?: string;
  className?: string;
}) {
  const src = peaks.length > 0 ? peaks : new Array(bars).fill(0.45);
  const step = src.length / bars;
  return (
    <div className={cn("flex items-center gap-[2.5px]", className)} style={{ height }} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        const v = Number(src[Math.floor(i * step)] ?? 0.4);
        return (
          <span
            key={i}
            className="block flex-1 rounded-full"
            style={{
              minWidth: 2,
              maxWidth: 3.5,
              height: `${Math.max(14, Math.round(v * 100))}%`,
              background: i / bars < progress ? color : dim,
              transition: "background var(--motion-fast)",
            }}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- controls */
export function PlayButton({
  playing,
  onClick,
  size = 46,
  label,
  tone = "light",
}: {
  playing: boolean;
  onClick: () => void;
  size?: number;
  label: string;
  tone?: "light" | "dark";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "press grid shrink-0 place-items-center rounded-full",
        tone === "light" ? "bg-white text-black" : "bg-accent text-accent-ink",
      )}
      style={{ width: size, height: size }}
    >
      <Icon name={playing ? "pause" : "play"} size={Math.round(size * 0.42)} />
    </button>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-marigold", className)}
      style={{ boxShadow: "0 0 0 3px var(--marigold-glow)" }}
    />
  );
}

export function Avatar({ src, name, size = 40, ring = false }: { src: string | null; name: string; size?: number; ring?: boolean }) {
  return (
    <span
      className="relative inline-block shrink-0 overflow-hidden rounded-full bg-well"
      style={{ width: size, height: size, boxShadow: ring ? "0 0 0 2px #fff, 0 0 0 3px var(--line)" : undefined }}
    >
      {src ? <Photo src={src} alt={name} sizes={`${size * 2}px`} position="center 30%" /> : <Monogram name={name} size={size} />}
    </span>
  );
}

/** One of the five family petal colours (app/tokens.css), stable per key: a person without a photo still has a colour of their own. */
export function petalFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `var(--petal-${(h % 5) + 1})`;
}

export function Monogram({ name, size }: { name: string; size: number }) {
  return (
    <span
      className="voice grid h-full w-full select-none place-items-center text-white"
      style={{ background: petalFor(name || "?"), fontSize: Math.max(14, size * 0.44) }}
      aria-hidden="true"
    >
      {(name || "?").trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

/* ---------------------------------------------------------------- rooms */
/**
 * One compact sticky header for every page, two rows at most (<= 104px with the gap):
 *   row 1  back chevron (44px) + the ROOM's name beside it ("Family", "Care"...) in the title size;
 *   row 2  the room's sub-pages as a scrollable pill row, the open one filled with the accent.
 * A room with one page (Kitchen) shows row 1 only. A page opened from a room (a recipe, an album,
 * a person, Settings) shows back + its own title. The room names are lib/menu.ts titles, verbatim.
 * Back goes to where you came in (tabs replace each other, so they never stack).
 */
export function RoomHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode; /** Kept for callers: the header names the room itself on a room's own pages. */ room?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { viewer, members, ready } = useViewer();
  const hasKids = members.some((m) => isKid(m));
  // Before the family loads, `viewer` is a stand-in grown-up, so a child would briefly get the
  // grown-ups' tabs: hold the row empty until we know who is looking.
  const known = ready && members.some((m) => m.id === viewer.id);
  const at = known ? tabsFor(pathname, canStartPortrait(viewer), isKid(viewer), hasKids) : null;
  const pending = !known && tabsFor(pathname, false, false, hasKids) !== null;
  const own = roomOf(pathname);
  const name = (at?.space.title ?? own?.title ?? title) || "";
  const active = useRef<HTMLAnchorElement>(null);
  // The last pills (Play, Nearby) sit past the screen edge: bring the open one into view, without animating.
  // Measured in the row's own pixels (not scrollIntoView), so it is right under the elders' larger text zoom too.
  useEffect(() => {
    const tab = active.current;
    const row = tab?.parentElement;
    if (!tab || !row) return;
    const gutter = 24;
    const left = tab.offsetLeft - gutter;
    const right = tab.offsetLeft + tab.offsetWidth + gutter;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
  }, [pathname]);
  return (
    <header
      data-ui="room-header"
      className="sticky top-0 z-30 -mx-4 mb-3 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--paper)_92%,transparent)] px-4 backdrop-blur"
      style={{ marginTop: "calc(-16px - env(safe-area-inset-top))", paddingTop: "calc(4px + env(safe-area-inset-top))" }}
    >
      <div className="flex h-11 items-center gap-1">
        <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))} aria-label="Back" className="press -ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-full">
          <Icon name="back" />
        </button>
        <h1 className="m-0 min-w-0 flex-1 truncate text-title font-semibold leading-tight tracking-[-0.015em]">{name}</h1>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {pending && <div className="h-11" aria-hidden />}
      {at && (
        <nav data-ui="room-tabs" aria-label={at.space.title} className="no-scrollbar -mx-4 flex h-11 items-center overflow-x-auto px-4">
          {at.space.rooms.map((r) => {
            const on = r.href === at.room;
            return (
              <Link key={r.href} href={r.href} replace ref={on ? active : undefined} aria-current={on ? "page" : undefined} className="press flex h-11 shrink-0 items-center pr-2 no-underline">
                <span className={cn("flex h-9 items-center rounded-full px-4 text-callout transition-colors", on ? "bg-accent font-semibold text-accent-ink" : "bg-well font-medium text-ink-soft")}>{r.title}</span>
              </Link>
            );
          })}
        </nav>
      )}
      {/* The page's own title, when the header shows the room's name instead: for screen readers. */}
      {(subtitle || (name && title && name !== title)) && <p className="sr-only">{[name !== title ? title : "", subtitle].filter(Boolean).join(". ")}</p>}
    </header>
  );
}

export function SectionTitle({ children, href, linkLabel }: { children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-3 mt-8 flex items-baseline justify-between">
      <h2 className="m-0 text-title">{children}</h2>
      {href && (
        <Link href={href} className="text-callout font-medium text-ink-soft no-underline">
          {linkLabel ?? "See all"}
        </Link>
      )}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "quiet";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "press flex h-11 items-center justify-center gap-2 rounded-full px-5 text-body font-semibold disabled:opacity-40",
        variant === "primary" && "bg-accent text-accent-ink",
        variant === "secondary" && "bg-surface text-ink",
        variant === "quiet" && "bg-transparent text-ink-soft",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Provenance mark for anything Muse prepared. Small, honest, never a mascot:
 * the family's words stay theirs; Muse only wrote down, translated or asked.
 */
/**
 * Muse is an invisible helper (SPEC §29.13): people see what it did, not its
 * name. The mark renders only where Muse is the subject (What Muse did).
 */
export function MuseMark({ children = "powered by Muse", tone = "soft", className, show = false }: { children?: React.ReactNode; tone?: "soft" | "light"; className?: string; show?: boolean }) {
  if (!show) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-caption font-medium", tone === "light" ? "text-white/80" : "text-ink-faint", className)}>
      <Icon name="sparkle" size={13} strokeWidth={1.8} />
      {children}
    </span>
  );
}

/**
 * A room with nothing in it yet: a calm photo band, one line of why, one
 * clear action. Suggestions (what the code can already start) go underneath.
 */
export function EmptyState({
  photo,
  position = "center",
  title,
  line,
  action,
  children,
  className,
}: {
  photo?: string | null;
  position?: string;
  title: React.ReactNode;
  line: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-card bg-card shadow-card", className)}>
      <div className="relative h-[152px]">
        {photo ? (
          <Photo src={photo} sizes="(max-width: 480px) 100vw, 480px" position={position} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/brand/mark.svg" alt="" width={56} height={56} className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 opacity-60" />
        )}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--card)] to-transparent" aria-hidden="true" />
      </div>
      <div className="px-4 pb-5">
        <p className="m-0 text-title font-semibold leading-tight tracking-[-0.01em]">{title}</p>
        <p className="m-0 mt-1.5 text-body leading-snug text-ink-soft">{line}</p>
        {action && <div className="mt-4">{action}</div>}
        {children}
      </div>
    </section>
  );
}

/** A suggestion the page can already start: an icon, a name, one line. Fills a 2-column grid. */
export function SuggestionTile({ icon, title, line, onClick, href, disabled }: { icon: IconName; title: string; line?: string; onClick?: () => void; href?: string; disabled?: boolean }) {
  // With a line: icon above, two lines of words. Name only: one compact row.
  const cls = cn(
    "press flex h-full w-full rounded-[22px] bg-card p-4 text-left text-ink no-underline shadow-card disabled:opacity-60",
    line ? "min-h-[120px] flex-col items-start gap-3" : "min-h-[56px] items-center gap-3 py-3 pl-3",
  );
  const body = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-well">
        <Icon name={icon} size={19} strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block text-body font-semibold leading-tight">{title}</span>
        {line && <span className="mt-1 block text-callout leading-snug text-ink-soft">{line}</span>}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {body}
    </button>
  );
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="m-0 py-6 text-center text-body text-ink-soft">{children}</p>;
}

/* -------------------------------------------------------------- actions */
export interface MenuAction {
  label: string;
  onSelect: () => void | Promise<void>;
  /** Destructive: asks once more, inside the menu ("Delete? Yes / Keep"). */
  danger?: boolean;
  confirm?: string;
}

/**
 * The "⋯" for one thing (a voice note, a recipe, a need). Opens a small
 * frosted menu; destructive actions confirm in place, never with a browser
 * dialog. Closes on outside tap or Escape.
 */
export function ActionMenu({ actions, label = "More", tone = "soft", className }: { actions: MenuAction[]; label?: string; tone?: "soft" | "light"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(null);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (actions.length === 0) return null;
  const run = async (a: MenuAction) => {
    setBusy(true);
    try {
      await a.onSelect();
    } finally {
      setBusy(false);
      setOpen(false);
      setConfirming(null);
    }
  };
  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn("press grid h-11 w-11 place-items-center rounded-full", tone === "light" ? "text-white" : "text-ink-soft")}
      >
        <Icon name="more" size={20} />
      </button>
      {open && (
        <div role="menu" className="frost absolute right-0 top-11 z-30 min-w-[200px] rounded-[18px] p-1.5" onClick={(e) => e.stopPropagation()}>
          {actions.map((a, i) =>
            confirming === i ? (
              <div key={a.label} className="px-3 py-2">
                <p className="m-0 text-callout text-ink">{a.confirm ?? `${a.label}?`}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void run(a)} className="press h-11 flex-1 rounded-full bg-[#b42318] text-callout font-semibold text-white">
                    {busy ? "…" : "Yes"}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="press h-11 flex-1 rounded-full bg-tint text-callout font-semibold">
                    Keep
                  </button>
                </div>
              </div>
            ) : (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => (a.danger ? setConfirming(i) : void run(a))}
                className={cn("press flex h-11 w-full items-center rounded-[12px] px-3 text-left text-body font-medium hover:bg-tint", a.danger && "text-[#b42318]")}
              >
                {a.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
