import type { Metadata, Viewport } from "next";
import { Kalam, Literata, Onest } from "next/font/google";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";
import { DEFAULT_IMAGE, HERO_SIZES, WINDOW_SIZES } from "@/lib/hero";
import "./globals.css";

const onest = Onest({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const literata = Literata({ subsets: ["latin"], style: ["italic"], weight: ["400", "500"], variable: "--font-voice", display: "swap", preload: false });
// Handwriting on printed photos (when, where, a note). Kalam covers Latin and Devanagari, so Hindi notes are handwritten too.
const kalam = Kalam({ subsets: ["latin", "devanagari"], weight: ["400"], variable: "--font-hand", display: "swap", preload: false });

// Same candidates and sizes as the courtyard header's <Photo> (components/courtyard.tsx), so the preload is the file it uses.
// The window's photo (signed in, door closed) gets the same early start: its WebP widths are the default photo's.
const WINDOW_SRCSET = [390, 780].map((w) => `${DEFAULT_IMAGE.replace(/\.jpg$/, `-${w}.webp`)} ${w}w`).join(", ");
const HERO_PRELOAD = `try{if(sessionStorage.getItem("aangan:door")==="open"){document.documentElement.dataset.door="open";var l=document.createElement("link");l.rel="preload";l.as="image";l.setAttribute("imagesrcset","/demo/courtyard-390.webp 390w, /demo/courtyard-780.webp 780w");l.setAttribute("imagesizes","${HERO_SIZES}");l.setAttribute("fetchpriority","high");document.head.appendChild(l)}else{var h=localStorage.getItem("aangan:hero");if(h&&h!==${JSON.stringify(DEFAULT_IMAGE)}){document.documentElement.dataset.hero="custom"}else if(innerWidth<900){var w=document.createElement("link");w.rel="preload";w.as="image";w.setAttribute("imagesrcset","${WINDOW_SRCSET}");w.setAttribute("imagesizes","${WINDOW_SIZES}");w.setAttribute("fetchpriority","high");document.head.appendChild(w)}}}catch(e){}`;

export const metadata: Metadata = {
  title: "Nearer — the window between two homes",
  description: "A live window between two homes: their time, weather and sky, a Safe & sound when they are well, and a lamp that says you are thinking of them.",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192" }, { url: "/icons/icon.svg", type: "image/svg+xml" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Nearer", statusBarStyle: "black-translucent" },
  // og:image comes from app/opengraph-image.tsx; APP_ORIGIN (at build time) makes its URL absolute.
  metadataBase: process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN) : undefined,
  openGraph: { type: "website", siteName: "Nearer", title: "Nearer", description: "The window between two homes." },
  twitter: { card: "summary_large_image", title: "Nearer", description: "The window between two homes." },
};

export const viewport: Viewport = {
  themeColor: "#2f5684",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Behind the door (sessionStorage, set by app/page.tsx) the first thing drawn is the courtyard photo:
            start fetching it now, in step with the scripts, not after they have run. */}
        <script dangerouslySetInnerHTML={{ __html: HERO_PRELOAD }} />
      </head>
      <body className={`${onest.variable} ${literata.variable} ${kalam.variable}`}>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
