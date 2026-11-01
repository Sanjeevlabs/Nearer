# public/demo — AI-generated seed assets

All files here are synthetic (Meta Muse Image, model `muse-image-1.0`). They
show a consistent fictional demo family — Dadi (elderly woman, silver bun,
maroon shawl), Arjun (man in his 30s), Leo (8-year-old boy), Aria (6-year-old
girl) — generated from one shared character block per prompt (see
`scripts/seed.mjs`). They are labelled demo photos in the app and never appear
inside real memory cards, which must only show the family's own uploads.

- `courtyard.jpg` (27 Oct 2026, `scripts/gen-courtyard.mjs`): fallback home
  illustration — arched wooden doorway, potted plants, morning light; no
  people. Used only when a member has no home photo. The in-app SVG courtyard
  (`components/courtyard-art.tsx`) remains the offline fallback.
- `home-courtyard.jpg`, `home-balcony.jpg`, `home-window.jpg` (not generated
  yet; the owner runs `META_API_KEY=... node scripts/gen-courtyard.mjs`, then
  `node scripts/demo-variants.mjs` for the 390/780 WebP widths): the first
  screen's default home photo options, 1024 square, no people. A North-Indian
  haveli courtyard at morning (tulsi, string cot, brass pots), a city balcony
  with plants at golden hour, an old wooden window with marigolds on the sill.
  The app keeps `courtyard.jpg` until `DEFAULT_IMAGE` in `lib/hero.ts` (re-exported
  from `lib/window-server.ts`) is switched to one of them.
- `family-dadi.webp`, `family-leo.webp`, `family-aria.webp`,
  `family-group.webp` (28 Oct 2026, `node scripts/seed.mjs`): consistent
  demo-family portraits. Manifest: `family.json`.


portrait-*.webp are square crops of the AI-generated family photos above (same synthetic people), used as each person's album portrait.

- `drawing-leo.webp` (1 Nov 2026): a child's crayon drawing of a house, a sun and
  three stick people, drawn with simple shapes by `Pillow` (not a model, no real
  child's work). It is the demo "Show" card from Leo on the kids' fridge strip.
