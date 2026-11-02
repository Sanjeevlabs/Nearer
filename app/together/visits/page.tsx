"use client";

import Link from "next/link";
import { TogetherPlans } from "@/components/together-plans";
import { Boundary } from "@/components/ui/boundary";
import { Icon } from "@/components/ui/kit";

export default function VisitsPage() {
  return (
    <>
      <Boundary label="Visits">
        <TogetherPlans kind="visit" />
      </Boundary>
      {/* Holidays is no longer a tab: it opens from here. */}
      <Link href="/together/holidays" data-ui="visits-holidays" className="press mt-4 flex min-h-[44px] items-center gap-1.5 text-callout font-semibold text-ink no-underline">
        <Icon name="calendar" size={16} /> Holidays <Icon name="chevron" size={14} />
      </Link>
    </>
  );
}
