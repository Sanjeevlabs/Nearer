"use client";

import { AnimatePresence, m } from "framer-motion";
import { callName, memberPhoto } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { useT } from "@/lib/use-t";
import { cn } from "@/lib/utils";
import { Avatar, Icon } from "./ui/kit";

// Who is this for? One person, or everyone in that home. Never assumes the
// other side is "Maa and Papa": a single parent, a guardian, an aunt who
// raised you are all just people in the list.

export function PeoplePicker({
  open,
  title,
  people,
  everyoneLabel,
  status,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  people: Member[];
  everyoneLabel?: string;
  /** Optional line under each name (their status). */
  status?: (m: Member) => { text: string; dot?: string } | null;
  onPick: (ids: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
          <m.button type="button" aria-label={t("picker.close")} className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <m.div
            className="frost relative w-full max-w-[480px] rounded-t-[32px] px-4 pt-3 text-ink"
            style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-black/15" aria-hidden="true" />
            <h2 className="m-0 mb-3 px-2 text-title">{title}</h2>
            <ul className="m-0 list-none overflow-hidden rounded-[22px] bg-white/90 p-0 ring-1 ring-black/[.05]">
              {people.length > 1 && (
                <li>
                  <button type="button" onClick={() => onPick(people.map((p) => p.id))} className="press flex w-full items-center gap-3.5 px-3.5 py-3 text-start">
                    <span className="flex -space-x-3">
                      {people.slice(0, 3).map((p) => (
                        <span key={p.id} className="rounded-full ring-2 ring-white">
                          <Avatar src={memberPhoto(p)} name={callName(p)} size={36} />
                        </span>
                      ))}
                    </span>
                    <span className="flex-1 text-body font-semibold">{everyoneLabel ?? t("picker.everyone")}</span>
                    <Icon name="chevron" size={16} className="text-ink-faint rtl:-scale-x-100" />
                  </button>
                </li>
              )}
              {people.map((p, i) => {
                const st = status?.(p);
                return (
                  <li key={p.id} className={cn((people.length > 1 || i) && "border-t border-[var(--line)]")}>
                    <button type="button" onClick={() => onPick([p.id])} className="press flex w-full items-center gap-3.5 px-3.5 py-3 text-start">
                      <span className="relative">
                        <Avatar src={memberPhoto(p)} name={callName(p)} size={40} />
                        {st?.dot && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white" style={{ background: st.dot }} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-body font-semibold leading-tight">{callName(p)}</span>
                        {st?.text && <span className="block truncate text-footnote text-ink-soft">{st.text}</span>}
                      </span>
                      <Icon name="chevron" size={16} className="text-ink-faint rtl:-scale-x-100" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
}
