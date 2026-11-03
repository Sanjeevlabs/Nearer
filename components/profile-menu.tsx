"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isDemoFamily } from "@/lib/family";
import { codeFromInput } from "@/lib/invite-link";
import { MAX_SIDES } from "@/lib/permissions";
import { memberPhoto } from "@/lib/people";
import { signOutNow } from "@/lib/sign-out";
import { cn } from "@/lib/utils";
import { AddSideSheet, myHome, openSide, useSides } from "./sides";
import { BottomSheet } from "./ui/bottom-sheet";
import { Avatar, Icon } from "./ui/kit";
import { useViewer } from "./viewer";

// Your own photo on the first screens: a small sheet, not a page. Sign out first, then For you,
// Settings, then your families: each one (tap to switch, this one marked), "Start another family"
// and "Join with a link". Escape, the close button and the backdrop close it, focus stays inside and
// goes back to the photo (the shared BottomSheet does all of that).

const ROW = "press flex min-h-[48px] w-full items-center gap-3 rounded-tile bg-surface px-4 py-2 text-left text-body font-semibold text-ink no-underline";

export function ProfileMenu({ size = 44, ring = false, inbox = true, className = "rounded-full", style, label = "You: account and settings" }: { size?: number; ring?: boolean; inbox?: boolean; className?: string; style?: React.CSSProperties; label?: string }) {
  const { viewer, members, relationships } = useViewer();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [out, setOut] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");
  const [bad, setBad] = useState(false);
  const { sides, current } = useSides(open);
  const close = () => setOpen(false);
  const demo = isDemoFamily(viewer.familyId);
  const kid = viewer.role === "child" || viewer.access === "child";
  const atLimit = sides.length >= MAX_SIDES;
  const goLink = () => {
    const code = codeFromInput(paste);
    if (!code) return setBad(true);
    close();
    router.push(`/join/${encodeURIComponent(code)}`);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label} aria-haspopup="dialog" data-ui="profile-menu-button" className={`press ${className}`} style={style}>
        <Avatar src={memberPhoto(viewer)} name={viewer.firstName} size={size} ring={ring} />
      </button>
      <BottomSheet open={open} onClose={close} title="You" dataUi="profile-menu">
        <ul className="m-0 list-none space-y-1.5 p-0">
          <li>
            <button
              type="button"
              disabled={out}
              onClick={() => {
                setOut(true);
                void signOutNow().finally(() => setOut(false));
              }}
              className={ROW}
              data-profile="sign-out"
            >
              <Icon name="logout" size={20} strokeWidth={1.8} />
              {out ? "Signing out…" : "Sign out"}
            </button>
          </li>
          {inbox && (
            <li>
              <Link href="/inbox" onClick={close} className={ROW} data-profile="inbox">
                <Icon name="bell" size={20} strokeWidth={1.8} />
                For you
              </Link>
            </li>
          )}
          <li>
            <Link href="/settings" onClick={close} className={ROW} data-profile="settings">
              <Icon name="settings" size={20} strokeWidth={1.8} />
              Settings
            </Link>
          </li>
        </ul>

        <section aria-label="Your families" className="mt-5" data-ui="profile-families">
          <h3 className="m-0 mb-2 text-footnote font-semibold text-ink-soft">Your families</h3>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {sides.map((s) => {
              const here = s.familyId === current;
              return (
                <li key={s.familyId}>
                  <button
                    type="button"
                    disabled={here || busy !== null}
                    aria-current={here ? "true" : undefined}
                    onClick={() => {
                      setBusy(s.familyId);
                      void openSide(s).finally(() => {
                        setBusy(null);
                        close();
                      });
                    }}
                    className={cn(ROW, here && "bg-accent text-accent-ink")}
                    data-profile={here ? "family-current" : "switch"}
                  >
                    <Icon name="people" size={20} strokeWidth={1.8} />
                    <span className="min-w-0 flex-1 truncate">{busy === s.familyId ? "Opening…" : `The ${s.name} family`}</span>
                    {here && <span className="text-footnote font-medium">You&rsquo;re here</span>}
                  </button>
                </li>
              );
            })}
            {!demo && atLimit && (
              <li>
                <p className="m-0 px-1 py-2 text-footnote text-ink-soft" data-ui="families-limit">
                  You&rsquo;re in {MAX_SIDES} families, the most Nearer allows.
                </p>
              </li>
            )}
            {!demo && !atLimit && !kid && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setAdding(true);
                  }}
                  className={ROW}
                  data-profile="start-family"
                >
                  <Icon name="plus" size={20} strokeWidth={1.8} />
                  Start another family
                </button>
              </li>
            )}
            {!demo && !atLimit && (
              <li>
                {pasting ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      goLink();
                    }}
                  >
                    <input
                      value={paste}
                      onChange={(e) => {
                        setBad(false);
                        setPaste(e.target.value);
                      }}
                      aria-label="Invite link"
                      placeholder="Paste the link"
                      dir="ltr"
                      autoFocus
                      autoCapitalize="off"
                      autoCorrect="off"
                      className="h-12 min-w-0 flex-1 rounded-full bg-surface px-5 text-body outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-black/15"
                      data-profile="join-link-input"
                    />
                    <button type="submit" disabled={!paste.trim()} className="press h-12 shrink-0 rounded-full bg-accent px-5 text-body font-semibold text-accent-ink" data-profile="join-link-open">
                      Open
                    </button>
                  </form>
                ) : (
                  <button type="button" onClick={() => setPasting(true)} className={ROW} data-profile="join-link">
                    <Icon name="key" size={20} strokeWidth={1.8} />
                    Join with a link
                  </button>
                )}
                {bad && (
                  <p className="m-0 mt-1.5 px-1 text-footnote text-[#b42318]" role="alert">
                    That doesn&rsquo;t look like an invite link.
                  </p>
                )}
              </li>
            )}
          </ul>
        </section>
      </BottomSheet>
      {adding && <AddSideSheet home={myHome(viewer.id, members, relationships)} onClose={() => setAdding(false)} />}
    </>
  );
}
