"use client";

import { validYearText } from "@/lib/birthday";
import { cn } from "@/lib/utils";

/**
 * The optional birth year beside a birthday's day and month: four digits, 1900 to this year,
 * never the future. It only edits text; the caller's Save (or Add) is what stores it.
 */
export function BirthYearField({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const bad = !validYearText(value);
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={4}
      aria-label="Birth year (optional)"
      aria-invalid={bad}
      placeholder="Year"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      className={cn("h-12 w-full rounded-full bg-surface px-5 text-body outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-marigold", bad && "ring-2 ring-[#b42318]", className)}
    />
  );
}
