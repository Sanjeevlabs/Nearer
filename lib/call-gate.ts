// The call page's consent gate, as plain functions (tested without a browser).
// Nothing that can touch the microphone or camera (the Jitsi script, its iframe,
// getUserMedia) runs before the person taps "Join with audio" or "Join with video".

export type JoinMedia = "audio" | "video";

export type CallPhase =
  /** Reading /api/sit: is this door still open to me? */
  | "checking"
  /** Our own pre-join: host, activity, until, and the three buttons. No media code has run. */
  | "prejoin"
  /** After the tap: asking the browser, fetching the room. */
  | "connecting"
  | "in"
  /** The browser (or the person) blocked the microphone or camera. */
  | "denied"
  /** Closed before joining: a token 404, an expired or unknown door. */
  | "closed"
  /** Closed while in it: the host left or its time ran out. */
  | "ended";

/** May anything that can start media exist in this phase? Only once the person has chosen. */
export function mediaAllowed(phase: CallPhase): boolean {
  return phase === "connecting" || phase === "in";
}

/** The only toolbar buttons: no select-background, no noise-suppression (both run non-Meta ML in the browser). */
export const CALL_TOOLBAR = ["microphone", "camera", "tileview", "fullscreen", "hangup"] as const;

/** Jitsi options for the chosen media. Our screen is the pre-join, so Jitsi's own stays off. */
export function jitsiConfig(media: JoinMedia): Record<string, unknown> {
  const audio = media === "audio";
  return {
    prejoinConfig: { enabled: false },
    startWithAudioMuted: false,
    startWithVideoMuted: audio,
    startAudioOnly: audio,
    disableDeepLinking: true,
    // Meta-only models: no in-browser segmentation/noise ML. The venue is a CSS frame around the call.
    disableVirtualBackground: true,
    toolbarButtons: [...CALL_TOOLBAR],
  };
}

/** The same choice as a Jitsi URL fragment (the plain-iframe fallback). */
export function jitsiHash(media: JoinMedia, displayName: string): string {
  const audio = media === "audio";
  return [
    "config.prejoinConfig.enabled=false",
    `config.startWithVideoMuted=${audio}`,
    `config.startAudioOnly=${audio}`,
    "config.disableVirtualBackground=true",
    `config.toolbarButtons=${encodeURIComponent(JSON.stringify(CALL_TOOLBAR))}`,
    `userInfo.displayName=%22${encodeURIComponent(displayName)}%22`,
  ].join("&");
}

/** Is a door (knock or sitting) still open at `nowMs`? Knocks until `until`; sittings until 3 h after they start. */
export function stillOpen(found: { until?: string; startsAt?: string } | undefined, nowMs: number): boolean {
  if (!found) return false;
  if (found.until) return Date.parse(found.until) > nowMs;
  if (found.startsAt) return Date.parse(found.startsAt) > nowMs - 3 * 3_600_000;
  return false;
}

/** What a getUserMedia failure means for the person: blocked, or no such device (then audio may still work). */
export function deniedReason(err: unknown): "blocked" | "missing" | "other" {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "blocked";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "missing";
  return "other";
}
