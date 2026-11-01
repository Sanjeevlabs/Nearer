import { beforeEach, describe, expect, it } from "vitest";
import { listDocs, listDocsMany, putDoc, resetDocs } from "@/lib/family-docs";

const FAM = "fam-many00000001";

beforeEach(() => resetDocs());

describe("listDocsMany", () => {
  it("returns the same lists as one listDocs per kind, keyed by kind", async () => {
    await putDoc(FAM, "presence", { id: "p1", memberId: "a", moment: "chai", note: "", at: "2026-01-01T00:00:00.000Z" });
    await putDoc(FAM, "presence", { id: "p2", memberId: "a", moment: "walk", note: "", at: "2026-01-02T00:00:00.000Z" });
    await putDoc(FAM, "care_settings", { id: "a", memberId: "a", shareVisits: false, updatedAt: "2026-01-01T00:00:00.000Z" });
    const many = await listDocsMany(FAM, ["presence", "care_settings", "need"] as const);
    expect(many.presence).toEqual(await listDocs(FAM, "presence"));
    expect(many.care_settings).toEqual(await listDocs(FAM, "care_settings"));
    expect(many.need).toEqual([]);
    expect(many.presence.map((p) => p.id)).toEqual(["p2", "p1"]);
  });

  it("does not leak another family's documents", async () => {
    await putDoc("fam-other0000001", "presence", { id: "x", memberId: "z", moment: "chai", note: "", at: "2026-01-01T00:00:00.000Z" });
    expect((await listDocsMany(FAM, ["presence"] as const)).presence).toEqual([]);
  });
});
