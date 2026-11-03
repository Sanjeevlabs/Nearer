// Every document kind the code can write must be allowed by the database's
// check constraint (supabase/schema.sql). Drift here is silent in mock mode
// and a hard failure live, so it's checked on every push.
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { DOC_SCHEMAS } from "@/lib/kinds";

describe("family_docs kind check matches lib/kinds.ts", () => {
  it("allows every DocKind", () => {
    const sql = readFileSync("supabase/schema.sql", "utf8");
    const line = sql.split("\n").find((l) => l.includes("family_docs_kind_check check"));
    expect(line).toBeDefined();
    const allowed = new Set(Array.from(line!.matchAll(/'([a-z_-]+)'/g), (m) => m[1]));
    const missing = Object.keys(DOC_SCHEMAS).filter((k) => !allowed.has(k));
    expect(missing).toEqual([]);
  });
});
