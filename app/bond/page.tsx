"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { canStartPortrait } from "@/lib/muse-portrait";
import { Button, EmptyLine, Icon, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { FamilyTree } from "@/components/family-tree";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { can } from "@/lib/permissions";
import { canShareTree } from "@/lib/share-rules";
import { Boundary } from "@/components/ui/boundary";

// Below the tree, or behind a tap: loaded after the tree has painted.
const BothSides = dynamic(() => import("@/components/sides").then((m) => m.BothSides), { ssr: false, loading: () => <div className="skeleton mt-10 h-[160px] rounded-card" aria-hidden="true" /> });
const InviteSheet = dynamic(() => import("@/components/invite-sheet").then((m) => m.InviteSheet), { ssr: false });
const GuidedAdd = dynamic(() => import("@/components/bond-add").then((m) => m.GuidedAdd), { ssr: false, loading: () => <div className="skeleton h-[320px] rounded-card" aria-hidden="true" /> });
const TreeShare = dynamic(() => import("@/components/tree-share").then((m) => m.TreeShare), { ssr: false, loading: () => <span className="inline-block h-11 w-24" aria-hidden="true" /> });

export default function BondPage() {
  // The family and how they are related are already loaded once for the whole app (the viewer): no second fetch.
  const { viewer, members, relationships, ready, refreshMembers } = useViewer();
  const [inviting, setInviting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [everAdded, setEverAdded] = useState(false);
  const [everInvited, setEverInvited] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);

  const mayAdd = can(viewer, "tree.add");
  const mayInvite = can(viewer, "invite.create");
  return (
    <div>
      <RoomHeader
        title="Family tree"
        subtitle="Every generation, both sides"
        action={
          mayInvite ? (
            <button type="button" onClick={() => { setEverInvited(true); setInviting(true); }} className="press flex h-11 items-center gap-1.5 rounded-full bg-card px-4 text-body font-semibold shadow-card">
              <Icon name="plus" size={16} />
              Invite
            </button>
          ) : undefined
        }
      />
      {!ready && <div key="loading" className="skeleton h-[420px] rounded-card" aria-busy="true" aria-label="Loading family" />}
      {ready && members.length === 0 && <EmptyLine>Couldn&rsquo;t load the family. Try again in a moment.</EmptyLine>}
      {ready && members.length > 0 && (
        <>
          <Boundary label="The family tree"><section aria-label="Family tree">
            <FamilyTree
              members={members}
              relationships={relationships}
              viewerId={viewer.id}
              onAdd={
                mayAdd
                  ? (id) => {
                      setAnchor(id);
                      setEverAdded(true);
                      setAdding(true);
                    }
                  : undefined
              }
            />
          </section></Boundary>
          <div className="mt-4 flex min-h-12 items-center gap-2">
            {mayAdd ? (
              <Button className="flex-1" onClick={() => { setAnchor(null); setEverAdded(true); setAdding(true); }}>
                Add someone
              </Button>
            ) : (
              <p className="m-0 flex-1 text-callout text-ink-soft">Ask a grown-up in the family to add people.</p>
            )}
            {canShareTree(viewer) && <TreeShare members={members} relationships={relationships} />}
          </div>
          {/* Portrait is no longer a tab: it opens from here (grown-ups only start one). */}
          {canStartPortrait(viewer) && (
            <Link href="/portrait" data-ui="tree-portrait" className="press mt-2 flex min-h-[44px] items-center gap-1.5 text-callout font-semibold text-ink no-underline">
              <Icon name="sparkle" size={16} /> Family portrait <Icon name="chevron" size={14} />
            </Link>
          )}
          <BothSides />
          {mayAdd && everAdded && (
            <BottomSheet open={adding} onClose={() => setAdding(false)} title="Add someone">
              <GuidedAdd
                anchor={anchor}
                onAdded={() => {
                  void refreshMembers();
                }}
              />
            </BottomSheet>
          )}
          {everInvited && <InviteSheet open={inviting} onClose={() => setInviting(false)} />}
        </>
      )}
    </div>
  );
}
