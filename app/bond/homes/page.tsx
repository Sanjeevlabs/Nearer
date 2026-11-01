"use client";

import { useEffect, useState } from "react";
import { RoomHeader } from "@/components/ui/kit";
import { Boundary } from "@/components/ui/boundary";
import { FamilyCircles, FamilyHomes } from "@/components/family-homes";
import { PetsSection } from "@/components/pets";
import { useViewer } from "@/components/viewer";

/** Family room, second tab: the family home by home, how close, and the pets. */
export default function HomesPage() {
  const { members, relationships } = useViewer();
  // Local times differ between server and browser: draw the homes once mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div>
      <RoomHeader title="Homes" subtitle="Home by home, with the time there, how close, and pets" />
      {!mounted ? (
        <div className="skeleton h-[420px] rounded-card" aria-busy="true" aria-label="Loading homes" />
      ) : (
      <Boundary label="Homes">
        <FamilyHomes members={members} relationships={relationships} />
        <FamilyCircles members={members} relationships={relationships} />
        <div className="mt-10">
          <PetsSection />
        </div>
      </Boundary>
      )}
    </div>
  );
}
