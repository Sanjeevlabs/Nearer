// Drawing kit shared by share cards (lib/share-cards.ts), stickers
// (lib/stickers.ts) and the posters (lib/poster.ts): canvases, the app's own
// fonts, images, text wrapping and the quiet footer every card carries.
// Browser only. Nothing here talks to a server or counts anything.

export const CARD_W = 1080;
export const CARD_H = 1350;

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

export function toPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export function loadImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    // Same-origin demo art and storage URLs that send CORS headers stay drawable (and exportable).
    if (!src.startsWith("data:") && !src.startsWith("blob:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export interface Fonts {
  body: string;
  voice: string;
  hand: string;
}

const FALLBACK: Fonts = { body: "Onest, system-ui, sans-serif", voice: "Literata, Georgia, serif", hand: "Kalam, 'Comic Sans MS', cursive" };

/**
 * The page's own fonts (next/font gives them hashed family names, exposed as
 * CSS variables), loaded before drawing so the canvas never falls back mid-card.
 */
export async function cardFonts(): Promise<Fonts> {
  if (typeof document === "undefined") return FALLBACK;
  const css = getComputedStyle(document.body);
  const pick = (v: string, fb: string) => css.getPropertyValue(v).trim() || fb;
  const fonts: Fonts = { body: pick("--font-body", FALLBACK.body), voice: pick("--font-voice", FALLBACK.voice), hand: pick("--font-hand", FALLBACK.hand) };
  // Load only the real family (the first in each stack): next/font's metric
  // "Fallback" face is local() and errors where that system font is missing,
  // which would reject the whole load.
  const first = (stack: string) => stack.split(",")[0].trim();
  await Promise.allSettled([
    document.fonts.load(`600 40px ${first(fonts.body)}`),
    document.fonts.load(`700 40px ${first(fonts.body)}`),
    document.fonts.load(`italic 400 40px ${first(fonts.voice)}`),
    document.fonts.load(`400 40px ${first(fonts.hand)}`, "Nearer"),
    document.fonts.load(`400 40px ${first(fonts.hand)}`, "आँगन"),
  ]);
  return fonts;
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Largest font size (from `max` down to `min`) at which `text` fits in `maxLines` lines. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxWidth: number, maxLines: number, max: number, min: number): { px: number; lines: string[] } {
  for (let px = max; px >= min; px -= 2) {
    ctx.font = font(px);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { px, lines };
  }
  ctx.font = font(min);
  const lines = wrap(ctx, text, maxWidth);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s,.;:]+\S*$/, "")}…`;
    return { px: min, lines: kept };
  }
  return { px: min, lines };
}

/** Cover-fit an image into a box (with an optional vertical focus, 0 top … 1 bottom). */
export function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number, focusY = 0.35): void {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * focusY, dw, dh);
}

/** The site's host, from where the page is served (never hard-coded). */
export function siteHost(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin.replace(/^https?:\/\//, "");
}

let markPromise: Promise<HTMLImageElement | null> | null = null;
function mark(): Promise<HTMLImageElement | null> {
  markPromise ??= loadImage("/icons/icon-192.png");
  return markPromise;
}

/**
 * The footer every card carries: the Nearer mark and the site. Small and
 * quiet, bottom-centred. `tone` picks ink for light or dark backgrounds.
 */
export async function drawFooter(ctx: CanvasRenderingContext2D, fonts: Fonts, opts: { w?: number; h?: number; tone?: "light" | "dark"; bottom?: number } = {}): Promise<void> {
  const W = opts.w ?? CARD_W;
  const H = opts.h ?? CARD_H;
  const img = await mark();
  const size = 52;
  const host = siteHost();
  ctx.save();
  ctx.font = `600 28px ${fonts.body}`;
  const label = host || "Nearer";
  const tw = ctx.measureText(label).width;
  const total = size + 16 + tw;
  const x = (W - total) / 2;
  const y = H - (opts.bottom ?? 64) - size;
  if (img) {
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 13);
    ctx.clip();
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
    ctx.save();
  }
  ctx.font = `600 28px ${fonts.body}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = opts.tone === "dark" ? "rgba(255,255,255,.82)" : "rgba(17,17,17,.72)";
  ctx.fillText(label, x + size + 16, y + size / 2 + 1);
  ctx.restore();
}

/** "26 Oct 2026" — a date for a card, in the speaker's zone when known. */
export function cardDate(iso: string, tz?: string | null): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", day: "numeric", month: "short", year: "numeric" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "nearer";
}
