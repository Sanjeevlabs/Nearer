const shapes = [
  [/\bonions?\b/i, "M12 7c1 3 7 5 7 9a7 5 0 0 1-14 0c0-4 6-6 7-9Zm0 0V3m-3 1 3 3m3-3-3 3m0 3c-3 3-4 7-2 10"],
  [/\bgarlic\b/i, "M11 4h2v5c5 0 7 4 6 8-1 4-13 4-14 0-1-4 1-8 6-8Zm0 6c-3 3-3 7-1 10m3-10c3 3 3 7 1 10"],
  [/\bginger\b/i, "M4 17l4-5-3-4 3-2 4 4 3-6 3 2-2 6 5 1-1 4-6-1-5 4Z"],
  [/\btomato(?:es)?\b/i, "M12 8c7-3 10 2 8 8-2 7-14 7-16 0C2 10 5 5 12 8Zm0 0 4 3m-4-3-4 3m4-3 1-4"],
  [/\bpotato(?:es)?\b/i, "M5 8c5-6 12-4 15 2 3 6-1 10-7 10C5 20 1 14 5 8Zm4 3h.01m6 4h.01m1-6h.01m-8 7h.01"],
  [/\brice\b/i, "M4 12h16a8 8 0 0 1-16 0Zm3-3 2-2m3 2 2-3m2 4 2-2m-7-3 1-2"],
  [/\b(?:lentils?|dal|moong|toor)\b/i, "M5 8a3 2 0 1 0 6 0 3 2 0 1 0-6 0Zm9 2a3 2 0 1 0 6 0 3 2 0 1 0-6 0ZM8 16a4 3 0 1 0 8 0 4 3 0 1 0-8 0Z"],
  [/\b(?:flour|atta)\b/i, "M8 4h8l4 15-2 2H6l-2-2Zm-1 5h10m-8 8c0-3 4-5 6-4 0 4-3 6-6 4Z"],
  [/\bmilk\b/i, "M7 9h10v12H7zm0 0 3-6h7v6m-7-6 4 6m0 0v12m-5-7h3"],
  [/\b(?:yogh?urt|curd)\b/i, "M5 8h14v3H5zm2 3 2 9h6l2-9m-6 3h2m-2 3h2"],
  [/\b(?:butter|ghee)\b/i, "M4 12l5-5h10l2 5-5 6H4zm0 0h12l3-5m-3 5v6"],
  [/\boil\b/i, "M10 3h4v4l3 4v9H7v-9l3-4zm-3 9h10m-5 1c-3 4-3 5 0 5s3-1 0-5Z"],
  [/\beggs?\b/i, "M19 15a7 7 0 0 1-14 0C5 9 9 4 12 4s7 5 7 11Zm-9 3c-1-.3-2-1-2-3"],
  [/\bchicken\b/i, "M10 14c-4-1-5-5-2-8s8-3 10 0c3 4-1 8-4 8l-4 4a2 2 0 1 1-3 2 2 2 0 1 1-1-4Z"],
  [/\b(?:fish|salmon|tuna)\b/i, "M3 12c5-7 11-7 15 0l4-4v8l-4-4c-4 7-10 7-15 0Zm5-1h.01"],
  [/\bpaneer\b/i, "M4 10l8-5 8 4-8 5Zm0 0v6l8 4 8-5V9m-8 5v6m-3-9 6-4"],
  [/\bspinach\b/i, "M5 20c-4-10 6-15 15-16 0 11-5 17-13 15m-3 3L16 8m-8 9v-5m3 2h5"],
  [/\b(?:chilli|chili|chile)s?\b/i, "M18 7c-7-3-7 9-15 12 10 2 16-3 17-9 0-2-1-3-2-3Zm0 0c0-3 1-4 3-4"],
  [/\b(?:coriander|cilantro|dhaniya)\b/i, "M12 21V9m0 5C2 14 4 7 9 9l3 3m0 2c9 0 10-7 5-6l-5 4m0-3c-4-2-3-6 0-6s4 4 0 6Z"],
  [/\b(?:cumin|jeera)\b/i, "M5 16l4-6m0 8 4-6m0-5 2-3m0 14 4-6m-1-3 2-3"],
  [/\b(?:turmeric|haldi)\b/i, "M5 17c-2-2 0-5 3-6l7-5c4-3 7 1 4 4l-8 8c-2 2-4 2-6-1Zm3-6 2 2m3-5 2 2m-4 7-2-2"],
  [/\bsalt\b/i, "M8 7h8l3 13H5Zm1-1V4h6v2m-5 8h.01m4 2h.01m-1-4h.01"],
  [/\b(?:sugar|jaggery)\b/i, "M5 8l7-4 7 4v8l-7 4-7-4Zm0 0 7 4 7-4m-7 4v8m-3-7h.01m6 2h.01"],
  [/\b(?:lemon|lime)s?\b/i, "M4 16C3 9 9 4 16 5l3-1-1 3c4 7-3 14-10 12l-3 1 1-3Zm5 0c-1-4 2-7 5-8"],
  [/\bcarrots?\b/i, "M15 8c-3-2-6 0-7 3L4 21l10-5c4-2 4-6 1-8Zm0 0 2-5m0 6 4-4m-4 6 4-1m-12 2 3 3"],
  [/\bpeas?\b/i, "M4 17c4 4 13 1 16-9-5-1-7 1-10 4-2 2-4 4-6 5Zm6-2h.01m4-2h.01m3-3h.01"],
  [/\bcauliflower\b/i, "M7 15a4 4 0 0 1-2-7 4 4 0 0 1 5-3 4 4 0 0 1 6 0 4 4 0 0 1 3 7l-4 4-1 4h-4l-1-4Zm2 1 3-3 3 3"],
  [/\bcabbage\b/i, "M20 13a8 8 0 1 1-16 0 8 8 0 1 1 16 0Zm-15-1c7 0 9 4 9 8m5-9c-4 0-7 2-7 4m0-10v6"],
  [/\bbeans?\b/i, "M4 10c4-6 12-8 14-2 1 3-4 4-5 7-2 5-8 5-9 1-1-2-1-4 0-6Zm4 1c1-2 3-3 5-3"],
  [/\bmushrooms?\b/i, "M3 12a9 8 0 0 1 18 0c-2 3-16 3-18 0Zm7 2-1 5h6l-1-5m-5-4h.01m7-2h.01"],
  [/\bbread\b/i, "M5 11c-4-3 0-7 7-7s11 4 7 7v8H5Zm3 2v3h8v-3"],
  [/\bpasta\b/i, "M4 7l6 3h4l6-3v10l-6-3h-4l-6 3Zm6 3v4m4-4v4"],
  [/\bcheese\b/i, "M3 13l10-8 8 8v6H3Zm0 0h18m-14 3h.01m5 1h.01m2-7h.01m3 6h.01"],
  [/\bhoney\b/i, "M6 8h12v12H6zm2 0V5h8v3m-4 3-3 2v3l3 2 3-2v-3Z"],
  [/\b(?:nuts?|almonds?|cashews?|peanuts?|walnuts?)\b/i, "M9 6c-3 0-3 5-2 7s-2 4 1 6 7-1 7-5 3-4 2-7-6-4-8-1Zm1 1c-2 4 4 6 0 10"],
  [/\bapples?\b/i, "M12 8c-4-3-8 0-8 5 0 4 3 8 6 7l2-1 2 1c3 1 6-3 6-7 0-5-4-8-8-5Zm0 0c0-3 2-5 5-5"],
  [/\bbananas?\b/i, "M6 5c-2 8 4 13 14 10l1 3C9 24 2 15 3 7Zm0 0 1-2"],
  [/\bcoconut\b/i, "M20 13a8 7 0 1 1-16 0 8 7 0 1 1 16 0Zm-11-2h.01m3 3h.01m3-4h.01"],
  [/\btea\b/i, "M4 10h13v4c0 4-2 6-6 6s-7-2-7-6Zm13 1h2a2 2 0 0 1 0 4h-2m-5-5v4m-1 0h2v3h-2Z"],
  [/\bcoffee\b/i, "M7 6c4-5 12-2 12 3 0 5-5 11-10 11-6 0-6-9-2-14Zm0 13c1-6 8-6 9-13"],
  [/\bwater\b/i, "M12 3c3 5 6 9 6 12a6 6 0 1 1-12 0c0-3 3-7 6-12Zm-3 12c0 2 1 3 2 3"],
] as const;

export function ingredientIconPath(item: string): string {
  return shapes.find(([words]) => words.test(item))?.[1] ?? "M5 10h14v9H5zM8 10V6h8v4m-6 4h4";
}

export function IngredientIcon({ item }: { item: string }) {
  const path = ingredientIconPath(item);
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
}
