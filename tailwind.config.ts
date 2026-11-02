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
        tint: "var(--tint)",
        deep: "var(--deep)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        line: "var(--line)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        "accent-soft-ink": "var(--accent-soft-ink)",
        coral: "var(--petal-1)",
        teal: "var(--petal-2)",
        blue: "var(--petal-3)",
        plum: "var(--petal-4)",
        amber: "var(--petal-5)",
        "coral-soft": "var(--petal-1-soft)",
        "teal-soft": "var(--petal-2-soft)",
        "blue-soft": "var(--petal-3-soft)",
        "plum-soft": "var(--petal-4-soft)",
        "amber-soft": "var(--petal-5-soft)",
        espresso: "var(--espresso)",
        "espresso-ink": "var(--espresso-ink)",
        "ink-faint": "var(--ink-faint)",
        marigold: "var(--marigold)",
      },
      // Semantic type scale (docs/DESIGN.md): mobile-first, fluid where it matters. Never below 12px.
      fontSize: {
        display: ["var(--text-display)", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        title: ["var(--text-title)", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
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
        tile: "var(--radius-tile)",
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
