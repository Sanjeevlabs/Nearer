"use client";

import Link from "next/link";
import { useState } from "react";
import { memberPhoto } from "@/lib/people";
import { signOutNow } from "@/lib/sign-out";
import { openSide, useSides } from "./sides";
import { BottomSheet } from "./ui/bottom-sheet";
import { Avatar, Icon } from "./ui/kit";
import { useViewer } from "./viewer";

// Your own photo on the first screens: a small sheet, not a page. Sign out first, then For you,
// Settings and, with more than one family, a way across. Escape, the close button and the backdrop
// close it, focus stays inside and goes back to the photo (the shared BottomSheet does all of that).

const ROW = "press flex min-h-[48px] w-full items-center gap-3 rounded-tile bg-surface px-4 py-2 text-left text-body font-semibold text-ink no-underline";

export function ProfileMenu({ size = 44, ring = false, inbox = true, className = "rounded-full", style, label = "You: account and settings" }: { size?: number; ring?: boolean; inbox?: boolean; className?: string; style?: React.CSSProperties; label?: string }) {
  const { viewer } = useViewer();
  const [open, setOpen] = useState(false);
  const [out, setOut] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { sides, current } = useSides(open);
  const others = sides.filter((s) => s.familyId !== current);
  const close = () => setOpen(false);

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
          {others.map((s) => (
            <li key={s.familyId}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setBusy(s.familyId);
                  void openSide(s).finally(() => {
                    setBusy(null);
                    close();
                  });
                }}
                className={ROW}
                data-profile="switch"
              >
                <Icon name="people" size={20} strokeWidth={1.8} />
                {busy === s.familyId ? "Opening…" : `Switch to the ${s.name} side`}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}
