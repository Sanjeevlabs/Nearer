# public/demo — AI-generated seed assets

All files here are synthetic (Meta Muse Image, model `muse-image-1.0`). They
show a consistent fictional demo family — Dadi (elderly woman, silver bun,
maroon shawl), Arjun (man in his 30s), Leo (8-year-old boy), Aria (6-year-old
girl) — generated from one shared character block per prompt (see
`scripts/seed.mjs`). They are labelled demo photos in the app and never appear
inside real memory cards, which must only show the family's own uploads.

- `home-courtyard.jpg`, `home-balcony.jpg`, `home-window.jpg` (generated with
  `META_API_KEY=... node scripts/gen-courtyard.mjs`, then
  `node scripts/demo-variants.mjs` for the 390/780 WebP widths): photos of a
  home with no people, 1024 square. They are only used when a viewer picks the
  "Photo" mode for their first screen, and as demo memory photos. The first
  screen itself is drawn (`lib/hero.ts` picks the renderer) and nothing is
  painted before the app knows which screen to show.
- The old `courtyard.jpg` (an arched door) was retired on 2 Nov 2026; empty
  states use the brand mark on a plain ground instead.
- `lamp-lit.jpg`, `lamp-unlit.jpg`: a small brass lamp on a sill, lit and
  unlit, no people.
- `venues/*.jpg`: the places the family sits on a call.
- `family-dadi.webp`, `family-leo.webp`, `family-aria.webp`,
  `family-group.webp` (28 Oct 2026, `node scripts/seed.mjs`): consistent
  demo-family portraits. Manifest: `family.json`.


portrait-*.webp are square crops of the AI-generated family photos above (same synthetic people), used as each person's album portrait.

- `drawing-leo.webp` (1 Nov 2026): a child's crayon drawing of a house, a sun and
  three stick people, drawn with simple shapes by `Pillow` (not a model, no real
  child's work). It is the demo "Show" card from Leo on the kids' fridge strip.
