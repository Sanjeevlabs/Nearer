import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The semantic type scale (tailwind.config.ts) is a font-size group, so text-callout and text-ink-soft don't cancel each other.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["display", "title", "headline", "body", "callout", "footnote", "caption"] }] } },
});

// shadcn-style class merge helper. No custom design system beyond tokens.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
