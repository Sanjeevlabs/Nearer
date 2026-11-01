"use client";

import Link from "next/link";
import type { Gift } from "@/lib/gifts";
import { callName, memberPhoto } from "@/lib/people";
import { useJson } from "@/lib/use-json";
import { Avatar } from "./ui/kit";
import { useViewer } from "./viewer";

// For elders: proof that what they gave landed (someone cooked their recipe,
// heard their story). A quiet shelf of up to four lines, in words. No counts.

function dayName(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short" });
}

export function GiftsShelf() {
  const { members } = useViewer();
  const { data, failed } = useJson<{ gifts: Gift[] }>("/api/gifts");
  if (failed) return null;
  if (data === null) return <div className="skeleton h-[132px] rounded-card" aria-busy="true" aria-label="Loading" />;
  const gifts = data.gifts.slice(0, 4);
  if (gifts.length === 0) return null;
  return (
    <section aria-label="This week, your gifts" className="rounded-card bg-surface px-4 pb-1.5 pt-4">
      <h2 className="m-0 text-headline font-semibold">This week, your gifts</h2>
      <ul className="m-0 mt-1 list-none p-0">
        {gifts.map((g) => {
          const by = members.find((m) => m.id === g.byId);
          if (!by) return null;
          return (
            <li key={g.id}>
              <Link href={g.href} className="press flex min-h-12 items-center gap-3 py-1.5 text-ink no-underline">
                <Avatar src={memberPhoto(by)} name={callName(by)} size={36} />
                <span className="min-w-0 flex-1 text-body leading-snug">
                  <span className="font-semibold">{callName(by)}</span> {g.text}
                  <span className="whitespace-nowrap text-ink-faint">{" "}· {dayName(g.at)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
