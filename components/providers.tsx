"use client";

import { MotionConfig } from "framer-motion";
import { useEffect } from "react";
import { isNative } from "@/lib/native";
import { startUploadQueue } from "@/lib/upload-queue";
import { watchWrites } from "@/lib/use-json";
import { ThemeProvider } from "./theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  // Anything saved but not yet sent goes out on app start and when the network returns.
  useEffect(() => startUploadQueue(), []);
  // Any write (a card posted, a reaction, an approval) drops the cached lists and refetches the ones on screen.
  useEffect(() => watchWrites(), []);
  // Offline shell (public/sw.js). The native shell loads the live site and has its own offline.html, so it skips this.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || isNative() || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    // Cached pages and API copies are family data: drop them when the person changes.
    const clear = () => navigator.serviceWorker.controller?.postMessage("clear");
    window.addEventListener("aangan:auth", clear);
    return () => window.removeEventListener("aangan:auth", clear);
  }, []);
  return (
    <ThemeProvider>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </ThemeProvider>
  );
}
