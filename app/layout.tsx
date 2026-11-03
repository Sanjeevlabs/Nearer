import type { Metadata, Viewport } from "next";
import { Kalam, Literata, Onest } from "next/font/google";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";
import { EARLY_FETCH } from "@/lib/early";
import "./globals.css";

const onest = Onest({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const literata = Literata({ subsets: ["latin"], style: ["italic"], weight: ["400", "500"], variable: "--font-voice", display: "swap", preload: false });
// Handwriting on printed photos (when, where, a note). Kalam covers Latin and Devanagari, so Hindi notes are handwritten too.
const kalam = Kalam({ subsets: ["latin", "devanagari"], weight: ["400"], variable: "--font-hand", display: "swap", preload: false });

// Before any script: which view is likely (stepped inside? key slid?), so the server-sent shell
// (app/page.tsx CheckingShell) paints that view's drawn frame at once. Never a photo.
// Then, for someone already inside, the first screen's data is asked for at once (lib/early.ts), not after the bundle.
const VIEW_HINT = `try{var s=sessionStorage,d=document.documentElement,o=s.getItem("aangan:door")==="open",e=s.getItem("aangan:entered")==="1";if(o)d.dataset.door="open";if(e)d.dataset.entered="1";${EARLY_FETCH}}catch(x){}`;

export const metadata: Metadata = {
  title: "Nearer — the window between two homes",
  description: "A live window between two homes: their time, weather and sky, a Safe & sound when they are well, and a lamp that says you are thinking of them.",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" }], apple: "/brand/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Nearer", statusBarStyle: "black-translucent" },
  // og:image comes from app/opengraph-image.tsx; APP_ORIGIN (at build time) makes its URL absolute.
  metadataBase: process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN) : undefined,
  openGraph: { type: "website", siteName: "Nearer", title: "Nearer", description: "The window between two homes." },
  twitter: { card: "summary_large_image", title: "Nearer", description: "The window between two homes." },
};

export const viewport: Viewport = {
  themeColor: "#fafafa",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: VIEW_HINT }} />
      </head>
      <body className={`${onest.variable} ${literata.variable} ${kalam.variable}`}>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
