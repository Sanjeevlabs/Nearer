"use client";
// Two touches meet (an experiment; no claim about what it does for anyone). While a
// finger is held on the lamp, this device joins the pair's Supabase Realtime Presence
// channel(s) and nothing else: no messages, no content, no storage. If the other person
// is present on the same channel at the same moment, both see a shared glow. Letting go
// leaves the channel, and presence drops on disconnect, so a touch can never be stale.
// Connected only while holding (free-tier connection limits). Without Realtime (mock
// mode, no keys, a failure) it does nothing and the hold behaves exactly as before.
// Loaded on demand (dynamic import), so the window's first paint never carries it.
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface TouchPair {
  withId: string;
  channel: string;
}

export interface TouchSession {
  stop: () => void;
}

/** Join every pair channel while held; `onMet(true)` when someone else is present too. */
export async function holdTouch(me: string, pairs: TouchPair[], onMet: (withId: string | null) => void): Promise<TouchSession> {
  const none = { stop: () => undefined };
  if (pairs.length === 0) return none;
  try {
    const { browserAuth } = await import("./supabase-browser");
    const sb = browserAuth();
    if (!sb) return none;
    const channels: RealtimeChannel[] = [];
    let stopped = false;
    const metWith = new Set<string>();
    for (const p of pairs.slice(0, 2)) {
      const ch = sb.channel(p.channel, { config: { presence: { key: me } } });
      ch.on("presence", { event: "sync" }, () => {
        const here = Object.keys(ch.presenceState());
        const was = metWith.has(p.withId);
        const now = here.includes(p.withId);
        if (now) metWith.add(p.withId);
        else metWith.delete(p.withId);
        if (was !== now && !stopped) onMet(metWith.size ? Array.from(metWith)[0] : null);
      });
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED" && !stopped) void ch.track({ at: Date.now() });
      });
      channels.push(ch);
    }
    return {
      stop: () => {
        stopped = true;
        onMet(null);
        for (const ch of channels) void sb.removeChannel(ch);
      },
    };
  } catch {
    return none;
  }
}
