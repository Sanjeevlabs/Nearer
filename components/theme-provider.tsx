"use client";

import { useEffect } from "react";

// The first paint is set by THEME_HINT (lib/theme-hint.ts) in app/layout.tsx. This keeps "system" live
// when the phone switches between light and dark.
function apply() {
  try {
    const saved = localStorage.getItem("theme") || "system";
    if (saved !== "system") return;
    const m = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(m);
    root.style.colorScheme = m;
  } catch {
    // storage blocked: the first-paint script already chose from the phone's setting
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return <>{children}</>;
}
