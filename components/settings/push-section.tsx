"use client";

import { useEffect, useState } from "react";
import { useJson } from "@/lib/use-json";
import { disableNotifications, enableNotifications, pushIsOn, pushSupport, type EnableResult, type PushSupport } from "@/lib/web-push";
import { Group } from "./section";

// Settings, You: notifications on this device and which kinds you want. These are
// actions, not a draft: each switch saves as you flip it.

interface PushSettingsView {
  settings: { voice: boolean; lamp: boolean; asks: boolean; digest: boolean; safety: boolean };
  devices: number;
  configured: { app: boolean; web: boolean };
}

type Key = keyof PushSettingsView["settings"];
const CATEGORIES: { key: Key; label: string; hint: string }[] = [
  { key: "voice", label: "Voice memories, photos and videos for me", hint: "When someone sends one straight to you." },
  { key: "lamp", label: "The lamp", hint: "When someone lights it for you or sends a heartbeat." },
  { key: "asks", label: "Questions and requests", hint: "When someone asks you something, or a child asks for a story." },
  { key: "digest", label: "A morning summary", hint: "One note around 8 with the smaller things, like a blessing or a call tomorrow." },
  { key: "safety", label: "Safe & sound", hint: "When someone who chose you asks for help or has not checked in. Sent at any hour." },
];

const NOT_ON: Record<Exclude<EnableResult, "on">, string> = {
  denied: "Notifications are blocked. Allow them in your browser or phone settings, then try again.",
  "needs-install": "Add Nearer to your Home Screen first (Share, then Add to Home Screen), then open it from there.",
  unsupported: "This browser can't show notifications.",
  "not-configured": "Notifications aren't switched on for this server yet.",
  failed: "Couldn't turn them on. Try again.",
};

export function NotificationsSection({ onMessage }: { onMessage: (m: string) => void }) {
  const { data, failed, reload } = useJson<PushSettingsView>("/api/push/settings");
  const [support, setSupport] = useState<PushSupport>("unsupported");
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setSupport(pushSupport());
    void pushIsOn().then(setOn);
  }, [data?.devices]);

  if (failed && !data) return null;
  if (!data) return <Group title="Notifications" id="notifications"><div className="h-[72px] animate-pulse rounded-[22px] bg-surface" aria-busy="true" aria-label="Loading notifications" /></Group>;

  const configured = support === "native" ? data.configured.app : data.configured.web;

  const turnOn = async () => {
    setBusy("device");
    setNote(null);
    const r = await enableNotifications();
    setBusy(null);
    if (r === "on") {
      setOn(true);
      onMessage("Notifications are on");
      await reload();
    } else setNote(NOT_ON[r]);
  };
  const turnOff = async () => {
    setBusy("device");
    await disableNotifications();
    setBusy(null);
    setOn(false);
    onMessage("Notifications are off on this device");
    await reload();
  };
  const flip = async (key: Key, value: boolean) => {
    const res = await fetch("/api/push/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...data.settings, [key]: value }) }).catch(() => null);
    if (res?.ok) await reload();
    else onMessage("Couldn't save. Try again.");
  };
  const test = async () => {
    setBusy("test");
    setNote(null);
    const res = await fetch("/api/push/test", { method: "POST" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { devices?: number; sent?: number; configured?: boolean } | null;
    setBusy(null);
    if (!res?.ok || !j) setNote("Couldn't send a test. Try again.");
    else if (!j.configured) setNote("Notifications aren't switched on for this server yet.");
    else if (!j.devices) setNote("Turn notifications on for a device first.");
    else setNote(j.sent ? "Sent. It should arrive in a moment." : "Couldn't reach your device. Try turning notifications off and on again.");
  };

  const pill = "press h-11 rounded-full px-5 text-callout font-semibold disabled:opacity-50";
  const canAsk = configured && (support === "native" || support === "ready" || support === "needs-install" || support === "blocked");
  return (
    <Group title="Notifications" id="notifications">
      <div className="rounded-[22px] bg-surface px-4 py-4">
        <p className="m-0 text-body font-medium">{on ? "On for this device" : "Off for this device"}</p>
        <p className="m-0 text-footnote text-ink-soft">
          A gentle note when family sends you something. At most six a day, and none from 10 at night to 7 in the morning, except Safe &amp; sound.
        </p>
        {!configured ? (
          <p className="m-0 mt-3 text-footnote text-ink-soft">Notifications aren&rsquo;t switched on for this server yet.</p>
        ) : support === "unsupported" ? (
          <p className="m-0 mt-3 text-footnote text-ink-soft">{NOT_ON.unsupported}</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {on ? (
              <button type="button" disabled={busy !== null} onClick={() => void turnOff()} className={`${pill} bg-white text-ink`}>
                Turn off here
              </button>
            ) : (
              <button type="button" disabled={busy !== null || !canAsk} onClick={() => void turnOn()} className={`${pill} bg-accent text-accent-ink`}>
                {busy === "device" ? "Turning on…" : "Turn on"}
              </button>
            )}
            <button type="button" disabled={busy !== null} onClick={() => void test()} className={`${pill} bg-white text-ink`}>
              {busy === "test" ? "Sending…" : "Send me a test"}
            </button>
          </div>
        )}
        {support === "needs-install" && !on && <p className="m-0 mt-3 text-footnote text-ink-soft">{NOT_ON["needs-install"]}</p>}
        {support === "blocked" && !on && <p className="m-0 mt-3 text-footnote text-ink-soft">{NOT_ON.denied}</p>}
        {note && (
          <p role="status" className="m-0 mt-3 text-footnote text-ink-soft">
            {note}
          </p>
        )}
      </div>
      <div className="mt-3 divide-y divide-[var(--line)] rounded-[22px] bg-surface px-4">
        {CATEGORIES.map((c) => (
          <label key={c.key} className="flex min-h-[44px] items-center justify-between gap-3 py-4">
            <span>
              <span className="block text-body font-medium">{c.label}</span>
              <span className="block text-footnote text-ink-soft">{c.hint}</span>
            </span>
            <input type="checkbox" className="h-6 w-6 shrink-0 accent-black" checked={data.settings[c.key]} onChange={(e) => void flip(c.key, e.target.checked)} />
          </label>
        ))}
      </div>
    </Group>
  );
}
