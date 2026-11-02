// The build-docs pages: one source of truth for the generator (scripts/muse-docs.mjs) and the
// /docs route (lib/docs.ts). `brief` steers the generator only; it never reaches the reader.

/** @type {ReadonlyArray<{ slug: string, title: string, brief: string }>} */
export const DOC_PAGES = [
  {
    slug: "index",
    title: "What Nearer is and how it's built",
    brief:
      "Title the page exactly: What Nearer is and how it's built. Explain in plain language what Nearer is, who it is for, and how the build fits together: the app, the Muse helper, the rooms, native apps, hosting, tests. End with a short list linking to the other pages (architecture, muse, privacy-and-safety, performance, notifications, changelog) using links like /docs/architecture.",
  },
  {
    slug: "architecture",
    title: "Architecture",
    brief:
      "Explain the architecture: Next.js on Cloudflare Workers (OpenNext), Supabase, Capacitor native apps, the data model (families, members, cards, docs and whatever else the inputs show) and how data is scoped per family (tenancy). Include a table of the main API route groups from the route list.",
  },
  {
    slug: "muse",
    title: "How Muse is used",
    brief:
      "Explain how Muse (Meta's models) is used: every Meta model named in the inputs, what each is for, and the guardrails: Zod validation, one retry, fallback, spend cap, caching, and the What Muse did log. Use a table for models and a table or list for features by screen.",
  },
  {
    slug: "privacy-and-safety",
    title: "Privacy and safety",
    brief:
      "Explain privacy and safety as built: who can see what, private storage, family scoping, sessions, rate limits, what Muse may and may not do, Safe & sound, deletion and export. Only claims found in the inputs.",
  },
  {
    slug: "performance",
    title: "Performance",
    brief:
      "Explain how the app is kept fast: what is prerendered, caching, bundle and loading choices, budgets and checks. Quote numbers ONLY if they appear in the inputs; otherwise say the number is not verified.",
  },
  {
    slug: "notifications",
    title: "Notifications",
    brief:
      "Explain the push notification design: web push and native push, what triggers a note, quiet hours or gentleness rules if present, the sweep for overdue check-ins, the settings that control it. Only from the inputs.",
  },
  {
    slug: "changelog",
    title: "Changelog",
    brief:
      "A changelog built from the git log lines: group entries by PR number (the (#NN) at the end of a line), newest first. One heading per PR (### #NN and a short plain-language title), then one or two lines saying what changed. Commits without a PR number go under a final heading 'Other changes'.",
  },
];
