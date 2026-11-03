"use client";

import { useEffect, useState } from "react";
import { whatsappInvite } from "@/lib/invite-link";
import { can } from "@/lib/permissions";
import { postJson } from "@/lib/use-json";
import { BottomSheet } from "./ui/bottom-sheet";
import { Button, Icon } from "./ui/kit";
import { useViewer } from "./viewer";
import { fetchGet } from "@/lib/retry";

// Invite family, in place: one code (a live one if there is, else a new one)
// and the one-tap WhatsApp invite. Opened from the tree, the dock and the
// window, so inviting never means a trip to Settings.

/** A live invite code for this family, making one if none is left. Null when that fails. */
export async function inviteCode(): Promise<string | null> {
  try {
    const res = await fetchGet("/api/invites");
    const d = (await res.json()) as { invites?: { code: string; expiresAt: string }[] };
    const live = (d.invites ?? []).find((i) => Date.parse(i.expiresAt) > Date.now())?.code;
    if (live) return live;
    const made = await postJson<{ invite?: { code: string } }>("/api/invites", {});
    return made?.invite?.code ?? null;
  } catch {
    return null;
  }
}

export function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { viewer } = useViewer();
  const allowed = can(viewer, "invite.create");
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setState("busy");
    const c = await inviteCode();
    setCode(c);
    setState(c ? "idle" : "failed");
  };
  useEffect(() => {
    if (open && allowed && !code && state === "idle") void load();
  }, [open, allowed]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Invite family">
      {!allowed ? (
        <p className="m-0 mt-2 text-body text-ink-soft">Ask a grown-up in the family to invite people.</p>
      ) : (
        <>
          <p className="m-0 mt-1 text-body text-ink-soft">A sibling, a cousin, your in-laws. Send them this code; it works for 7 days.</p>
          {state === "failed" ? (
            <div className="mt-4 rounded-[22px] bg-card p-4 text-center shadow-card">
              <p className="m-0 text-body">Couldn&rsquo;t make a code just now.</p>
              <Button variant="secondary" className="mx-auto mt-3 !bg-well" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              <p data-display className="tnum m-0 mt-4 rounded-[22px] bg-card py-4 text-center text-display font-bold tracking-[0.12em] shadow-card" aria-busy={!code}>
                {code ?? "······"}
              </p>
              {code && (
                <>
                  <a href={whatsappInvite(window.location.origin, code)} target="_blank" rel="noopener noreferrer" className="press mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-body font-semibold text-accent-ink no-underline">
                    <Icon name="whatsapp" size={20} />
                    Send on WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => undefined);
                    }}
                    className="press mt-2 h-11 w-full rounded-full text-body font-semibold text-ink-soft"
                  >
                    {copied ? "Copied" : "Copy the code"}
                  </button>
                </>
              )}
            </>
          )}
        </>
      )}
    </BottomSheet>
  );
}
