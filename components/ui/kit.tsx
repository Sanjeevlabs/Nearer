"use client";

import * as L from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { roomOf, tabsFor } from "@/lib/spaces";
import { canStartPortrait } from "@/lib/muse-portrait";
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
} satisfies Record<string, L.LucideIcon>;

export type IconName = keyof typeof ICONS;
const SOLID = new Set<IconName>(["play", "pause", "stop"]);

export function Icon({ name, size = 22, className, strokeWidth = 2 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  const C = ICONS[name];
  return <C size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" fill={SOLID.has(name) ? "currentColor" : "none"} />;
}

/* ---------------------------------------------------------------- photo */
// next/image for bundled demo art (served as-is: see next.config.mjs); plain passthrough for
// signed/session URLs that the optimiser can't fetch.

/** The bundled demo photos come in small WebP widths too (scripts/demo-variants.mjs). */
function demoWidths(src: string): number[] | null {
  if (src === "/demo/courtyard.jpg" || /^\/demo\/home-(courtyard|balcony|window)\.jpg$/.test(src)) return [390, 780];
  if (/^\/demo\/family-[a-z]+\.webp$/.test(src)) return [440, 880];
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
        tone === "light" ? "bg-white text-black" : "bg-black text-white",
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

/** Warm, stable tone per name, so a person without a photo still looks like someone. */
const TONES: [string, string][] = [
  ["#f4d7b5", "#c98a5a"],
  ["#e7d3c0", "#a7705a"],
  ["#dfe3c8", "#8c9a5f"],
  ["#d7e2e4", "#6f8f99"],
  ["#ecd2d0", "#b06f6a"],
  ["#e6dcc9", "#9c8460"],
];
export function toneFor(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

/** Initial in the voice serif on a soft gradient: used wherever a portrait is missing. */
export function Monogram({ name, size }: { name: string; size: number }) {
  const [light, deep] = toneFor(name || "?");
  return (
    <span
      className="voice grid h-full w-full select-none place-items-center text-white"
      style={{ background: `radial-gradient(120% 120% at 30% 20%, ${light}, ${deep})`, fontSize: Math.max(14, size * 0.44) }}
      aria-hidden="true"
    >
      {(name || "?").trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

/* ---------------------------------------------------------------- rooms */
/** Header for every room: back to the courtyard, a large title, optional subtitle. */
export function RoomHeader({ title, subtitle, action, room }: { title: string; subtitle?: string; action?: React.ReactNode; /** For a page that is in a room but not one of its tabs (Send something → "Care"). */ room?: string }) {
  const router = useRouter();
  return (
    <header className="mb-5">
      <div className="mb-1 flex h-11 items-center justify-between">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          aria-label="Back"
          className="press -ml-2 grid h-11 w-11 place-items-center rounded-full"
        >
          <Icon name="back" />
        </button>
        {action}
      </div>
      <RoomName override={room} />
      <h1 className="m-0 text-[32px] font-light leading-[1.05] tracking-[-0.015em]">{title}</h1>
      {/* Subtitles stay in the code for screen readers only: the page says it, the header doesn't repeat it. */}
      {subtitle && <p className="sr-only">{subtitle}</p>}
      <SpaceTabs />
    </header>
  );
}

/** Which room of the house this tab page is in, as a quiet line above its title. */
function RoomName({ override }: { override?: string }) {
  const room = roomOf(usePathname());
  const title = override ?? room?.title;
  if (!title) return null;
  return <p className="m-0 mb-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-soft">{title}</p>;
}

/** The pages of the current room, as one quiet row. Only on a room's own tab page. */
function SpaceTabs() {
  const pathname = usePathname();
  const { viewer } = useViewer();
  const at = tabsFor(pathname, canStartPortrait(viewer));
  const active = useRef<HTMLAnchorElement>(null);
  // The last tabs (Play, Nearby) sit past the screen edge: bring the open one into view, without animating.
  // Measured in the row's own pixels (not scrollIntoView), so it is right under the elders' larger text zoom too.
  useEffect(() => {
    const pill = active.current;
    const row = pill?.parentElement;
    if (!pill || !row) return;
    const gutter = 20;
    const left = pill.offsetLeft - gutter;
    const right = pill.offsetLeft + pill.offsetWidth + gutter;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
  }, [pathname]);
  if (!at) return null;
  return (
    <nav aria-label={at.space.title} className="no-scrollbar relative -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 py-1">
      {at.space.rooms.map((r) => (
        <Link
          key={r.href}
          href={r.href}
          replace
          ref={r.href === at.room ? active : undefined}
          aria-current={r.href === at.room ? "page" : undefined}
          className={cn(
            // 40px pill, 44px hit area (the ::before reaches 2px past it, top and bottom).
            "press relative flex h-10 shrink-0 items-center rounded-full px-4 text-[15px] font-semibold no-underline before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-['']",
            r.href === at.room ? "bg-ink text-white" : "bg-card text-ink-soft shadow-card",
          )}
        >
          {r.title}
        </Link>
      ))}
    </nav>
  );
}

export function SectionTitle({ children, href, linkLabel }: { children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-3 mt-8 flex items-baseline justify-between">
      <h2 className="m-0 text-[20px]">{children}</h2>
      {href && (
        <Link href={href} className="text-[14px] font-medium text-ink-soft no-underline">
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
        "press flex h-[52px] items-center justify-center gap-2 rounded-full px-6 text-[16px] font-semibold disabled:opacity-40",
        variant === "primary" && "bg-black text-white",
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
    <span className={cn("inline-flex items-center gap-1 text-[12px] font-medium", tone === "light" ? "text-white/80" : "text-ink-faint", className)}>
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
  photo = "/demo/courtyard.jpg",
  position = "center",
  title,
  line,
  action,
  children,
  className,
}: {
  photo?: string;
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
        <Photo src={photo} sizes="(max-width: 480px) 100vw, 480px" position={position} />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--card)] to-transparent" aria-hidden="true" />
      </div>
      <div className="px-5 pb-5">
        <p className="m-0 text-[21px] font-semibold leading-tight tracking-[-0.01em]">{title}</p>
        <p className="m-0 mt-1.5 text-[15px] leading-snug text-ink-soft">{line}</p>
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
    line ? "min-h-[120px] flex-col items-start gap-3" : "min-h-[64px] items-center gap-3 py-3 pl-3",
  );
  const body = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-well">
        <Icon name={icon} size={19} strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-tight">{title}</span>
        {line && <span className="mt-1 block text-[14px] leading-snug text-ink-soft">{line}</span>}
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
  return <p className="m-0 py-6 text-center text-[15px] text-ink-soft">{children}</p>;
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
                <p className="m-0 text-[14px] text-ink">{a.confirm ?? `${a.label}?`}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void run(a)} className="press h-11 flex-1 rounded-full bg-[#b42318] text-[14px] font-semibold text-white">
                    {busy ? "…" : "Yes"}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="press h-11 flex-1 rounded-full bg-black/[.06] text-[14px] font-semibold">
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
                className={cn("press flex h-11 w-full items-center rounded-[12px] px-3 text-left text-[15px] font-medium hover:bg-black/[.04]", a.danger && "text-[#b42318]")}
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
