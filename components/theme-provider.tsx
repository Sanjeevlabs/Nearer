"use client";

// Nearer is light only: the first paint (THEME_HINT in app/layout.tsx) sets light, and nothing follows
// the phone's dark setting. Kept as a component so the layout's provider tree stays the same.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
