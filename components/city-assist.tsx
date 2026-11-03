"use client";

import { useT } from "@/lib/use-t";
import type { CitySource } from "@/lib/use-city-autofill";

/** Under the city field: where the guess came from, the "Use my location" tap, and a calm note if that did not work. */
export function CityAssist({ source, locating, failed, onUseLocation }: { source: CitySource; locating: boolean; failed: boolean; onUseLocation: () => void }) {
  const t = useT();
  return (
    <div className="mt-1.5">
      {source && <span className="block text-footnote text-ink-faint">{source === "location" ? t("auth.cityFromLocation") : t("auth.cityFromConnection")}</span>}
      {failed && (
        <span role="status" className="block text-footnote text-ink-faint">
          {t("auth.locationNo")}
        </span>
      )}
      <button type="button" onClick={onUseLocation} disabled={locating} className="press -ms-2 mt-0.5 flex min-h-11 items-center rounded-full px-2 text-footnote font-medium text-ink-soft disabled:opacity-60">
        {locating ? t("auth.locating") : t("auth.useLocation")}
      </button>
    </div>
  );
}
