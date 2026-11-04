// What Settings → Notifications says and offers for each kind of device (pure: tested in tests/push-guide.test.ts).
import type { PushSupport } from "./web-push";

export interface PushGuide {
  /** The button that replaces "Turn on"; null when no button should show (or the normal "Turn on" is right: see `turnOn`). */
  label: string | null;
  /** The normal Turn on button works here. */
  turnOn: boolean;
  /** Steps shown in a small sheet when the button is tapped. */
  steps: string[];
  /** Plain words under the buttons. */
  note: string;
}

/** iPhone / iPad (including iPadOS, which says "Macintosh"). */
export function isIos(ua: string, touchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

/** Safari itself, not Chrome / Firefox / Edge / Opera / Google app / in-app browsers on iOS. */
export function isIosSafari(ua: string, touchPoints = 0): boolean {
  return isIos(ua, touchPoints) && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|FBAN|FBAV|Instagram|Line\//.test(ua);
}

export const INSTALL_STEPS = [
  "Open nearer.site in Safari.",
  "Tap the Share button, then Add to Home Screen.",
  "Open Nearer from its new icon on your Home Screen, come back to Settings and tap Turn on.",
];

export function pushGuide(support: PushSupport, ua: string, touchPoints = 0): PushGuide {
  switch (support) {
    case "needs-install":
      return isIosSafari(ua, touchPoints)
        ? { label: "Add to Home Screen first", turnOn: false, steps: INSTALL_STEPS, note: "On iPhone, notifications work once Nearer is on your Home Screen." }
        : { label: null, turnOn: false, steps: [], note: "Open nearer.site in Safari to turn notifications on." };
    case "unsupported":
      return { label: null, turnOn: false, steps: [], note: "This browser can't show notifications." };
    case "blocked":
      return {
        label: null,
        turnOn: false,
        steps: [],
        note: isIos(ua, touchPoints)
          ? "Notifications are blocked for Nearer. Open the Settings app, tap Notifications, then Nearer, and switch on Allow Notifications."
          : /Android/.test(ua)
            ? "Notifications are blocked for Nearer. Press and hold the Nearer icon, tap App info, then Notifications, and allow them."
            : "Notifications are blocked. Tap the lock icon next to the address, set Notifications to Allow, then come back.",
      };
    default:
      return { label: null, turnOn: true, steps: [], note: "" };
  }
}
