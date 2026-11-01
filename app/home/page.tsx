"use client";

import { useRouter } from "next/navigation";
import { HomeSite } from "@/components/home-site";
import { resetFamilyCards } from "@/lib/use-family";

// The home page on any screen size (shared link, projector, or a phone).
export default function HomePage() {
  const router = useRouter();
  return (
    <HomeSite
      onDemo={async () => {
        const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inviteCode: "NEARER-DEMO", memberId: "arjun" }) });
        if (res.ok) {
          resetFamilyCards();
          window.dispatchEvent(new Event("aangan:auth"));
          router.push("/");
        }
      }}
    />
  );
}
