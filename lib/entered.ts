// "/" is the public home page (phone or laptop) until the person steps into
// the app once this session (Open Aangan, the demo, or any app route). After
// that, "/" is the app again, so in-app links back to "/" keep working.
// The installed app (home-screen PWA, Capacitor shell) never shows it.
import { isNative } from "@/lib/native";

const KEY = "aangan:entered";

export function hasEntered(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return true; // no sessionStorage: never trap someone on the site
  }
}

export function markEntered(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* private mode */
  }
}

/** Running as an installed app: a home-screen PWA or the native shell. */
export function isInstalledApp(): boolean {
  try {
    if (isNative()) return true;
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    return (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}
