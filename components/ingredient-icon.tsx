const shapes = [
  { words: /tomato|apple|lemon|lime|orange|pepper|chilli|chili|egg/, path: "M12 8c8-5 12 13 0 13S4 3 12 8Zm0 0c0-3 2-5 5-5" },
  { words: /onion|garlic|ginger|carrot|potato|beet|radish/, path: "M12 8c6 2 7 6 2 12l-2 2-2-2C5 14 6 10 12 8Zm0 0L9 3m3 5 3-5" },
  { words: /spinach|lettuce|basil|coriander|mint|cabbage|parsley|curry leaves/, path: "M4 19C3 9 9 4 21 3c-1 12-7 18-17 16Zm0 2L16 9" },
  { words: /rice|flour|wheat|oat|sugar|salt|cumin|lentil|bean|pea|almond|sesame|mustard|dal/, path: "M4 12h16c0 5-4 8-8 8s-8-3-8-8Zm4-4h.01M12 5h.01M16 8h.01" },
  { words: /milk|oil|water|cream|yogurt|ghee|vinegar|juice/, path: "M12 3c3 5 6 9 6 12a6 6 0 1 1-12 0c0-3 3-7 6-12Z" },
];

export function IngredientIcon({ item }: { item: string }) {
  const path = shapes.find(({ words }) => words.test(item.toLowerCase()))?.path ?? "M5 10h14v9H5zM8 10V6h8v4m-6 4h4";
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
}
