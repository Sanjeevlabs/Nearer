import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        card: "var(--card)",
        well: "var(--well)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        line: "var(--line)",
        accent: "var(--accent)",
        espresso: "var(--espresso)",
        "espresso-ink": "var(--espresso-ink)",
        "ink-faint": "var(--ink-faint)",
        marigold: "var(--marigold)",
      },
      // Semantic type scale (docs/DESIGN.md): mobile-first, fluid where it matters. Never below 12px.
      fontSize: {
        display: ["var(--text-display)", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        title: ["var(--text-title)", { lineHeight: "1.25", letterSpacing: "-0.01em" }],
        headline: ["var(--text-headline)", { lineHeight: "1.3" }],
        body: ["var(--text-body)", { lineHeight: "1.45" }],
        callout: ["var(--text-callout)", { lineHeight: "1.4" }],
        footnote: ["var(--text-footnote)", { lineHeight: "1.35" }],
        caption: ["var(--text-caption)", { lineHeight: "1.3" }],
      },
      fontFamily: {
        sans: ["var(--font-body)"],
        voice: ["var(--font-voice)"],
        hand: ["var(--font-hand)", "cursive"],
      },
      borderRadius: {
        sheet: "var(--radius-sheet)",
        card: "var(--radius-card)",
        hero: "var(--radius-hero)",
        cover: "var(--radius-cover)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        glass: "var(--glass-shadow)",
        card: "var(--card-shadow)",
        frost: "var(--frost-shadow)",
      },
    },
  },
  plugins: [],
};

export default config;
