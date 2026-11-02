"use client";

import { ShareButton } from "@/components/share-sheet";
import { useViewer } from "@/components/viewer";
import { constellation, familyStats } from "@/lib/constellation";
import { callName, memberPhoto } from "@/lib/people";
import type { PosterPerson } from "@/lib/poster";
import type { Member, Relationship } from "@/lib/schemas";
import { treeCard } from "@/lib/share-cards";
import { useJson } from "@/lib/use-json";

/** The tree as a poster to share, and the family's faces as a sticker badge. Grown-ups only. */
export function TreeShare({ members, relationships }: { members: Member[]; relationships: Relationship[] }) {
  const { viewer } = useViewer();
  const sides = useJson<{ current: string; sides: { familyId: string; name: string }[] }>("/api/sides");
  const name = sides.data?.sides.find((x) => x.familyId === sides.data?.current)?.name ?? "";
  const family = name ? `The ${name} family` : "Our family";
  const people = members.filter((m) => m.status !== "pending");
  return (
    <ShareButton
      label="Share"
      target={() => ({
        title: "Share the family tree",
        note: "A poster of your tree: faces, names and how you\u2019re related. Nothing else from the family.",
        filename: `${(name || "family").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-tree.png`,
        text: family,
        render: () => {
          const c = constellation(people, relationships, viewer.id);
          const stats = familyStats(c, people);
          const map = new Map<string, PosterPerson>(people.map((m) => [m.id, { id: m.id, name: m.id === viewer.id ? "You" : callName(m), label: c.nodes.find((n) => n.id === m.id)?.label ?? "", photo: memberPhoto(m), ring: m.role === "elder" ? "#f2a516" : m.role === "child" ? "#7fb069" : "#2f5684" }]));
          return treeCard(c, map, family, `${stats.people} people \u00b7 ${stats.generations} generations`);
        },
      })}
      sticker={() => {
        // Elders first, then the viewer's generation, then the children: up to 7 faces.
        const order = { elder: 0, adult: 1, child: 2 } as const;
        const faces = [...people].sort((a, b) => order[a.role] - order[b.role]).slice(0, 7).map((m) => ({ name: callName(m), photo: memberPhoto(m) }));
        return { kind: "tree", title: "Family badge", familyName: name || "Our", faces };
      }}
    />
  );
}
