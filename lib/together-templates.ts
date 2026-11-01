// Visits & holidays: the only plans Nearer keeps (SPEC §29.8 trims). Data
// only (client and server), like ritual configs: no culture or festival is
// hard-coded in logic.
import type { PROJECT_KINDS } from "./kind-values";

export interface TogetherTemplate {
  id: "visit" | "holiday";
  kind: (typeof PROJECT_KINDS)[number];
  title: string;
  blurb: string;
  /** Label for the "who" picker: the traveller for a visit, everyone going for a holiday. */
  whoLabel: string;
  tasks: string[];
}

export const TEMPLATES: TogetherTemplate[] = [
  {
    id: "visit",
    kind: "visit",
    title: "A visit home",
    blurb: "Dates, tickets, what to bring. A countdown both homes see.",
    whoLabel: "Who's coming home?",
    tasks: ["Fix the dates", "Book tickets", "List gifts to bring", "Plan the first meal at home", "Get the room ready"],
  },
  {
    id: "holiday",
    kind: "visit",
    title: "A family holiday",
    blurb: "Somewhere together. Who's going, the dates, and a countdown.",
    whoLabel: "Who's going?",
    tasks: ["Pick the place", "Fix the dates", "Book travel", "Book a stay", "Pack"],
  },
];

export function template(id: string | null | undefined): TogetherTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
