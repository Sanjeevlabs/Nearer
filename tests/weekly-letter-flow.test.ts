import { beforeEach, describe, expect, it } from "vitest";
import { dbAddCard, dbAddSuggestion, dbListSuggestions } from "@/lib/db";
import { deleteDoc, listDocs, memDocsOf } from "@/lib/family-docs";
import { POST as approvePOST } from "@/app/api/suggestions/[id]/approve/route";
import { POST as scanPOST } from "@/app/api/ritual-scan/route";
import { POST as weeklyPOST } from "@/app/api/letters/weekly/route";
import { GET as lettersGET } from "@/app/api/letters/route";
import { draftWeeklyLetter } from "@/lib/weekly-letter-run";
import { deleteCard, listCards, resetDemo } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

const IYER = "demo-iyer";
const FAM = "demo-family";

async function addIyerCards(n: number) {
  for (let i = 0; i < n; i++) {
    await dbAddCard({ familyId: IYER, type: "photo", caption: `Evening chai ${i}`, lang: "en", takenAt: new Date(Date.now() - 3600_000 * (i + 1)).toISOString(), authorId: "iyer-priya", source: "upload" });
  }
}
const letterSuggestions = async (fam: string) => (await dbListSuggestions(undefined, fam)).filter((s) => (s.payload as { action?: string }).action === "weekly_letter");
const post = (url: string, memberId: string, fam: string, body?: unknown) =>
  new Request(url, { method: "POST", headers: { cookie: sessionCookie(memberId, fam), "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
const approve = (id: string, memberId = "dadi", fam = FAM, body?: unknown) => approvePOST(post("http://test/api/approve", memberId, fam, body), { params: Promise.resolve({ id }) });
const scan = () => scanPOST(post("http://test/api/ritual-scan", "iyer-priya", IYER));

describe("weekly letter: approve, cron, manual route", () => {
  // The Iyer side starts quiet here (its seeded week is set aside), so each test counts only its own cards.
  beforeEach(async () => {
    resetDemo();
    for (const c of listCards().filter((x) => x.familyId === IYER)) deleteCard(c.id);
    for (const d of memDocsOf(IYER)) await deleteDoc(IYER, d.kind, d.data.id);
  });

  it("approving writes one written chitthi to the whole family; a second approve is 409", async () => {
    await addIyerCards(3);
    expect((await draftWeeklyLetter(IYER, { lang: "en", by: "manual" })).status).toBe("created");
    const [s] = await letterSuggestions(IYER);
    expect(s.status).toBe("pending");
    expect((await approve(s.id, "iyer-priya", IYER)).status).toBe(200);
    const written = (await listDocs(IYER, "chitthi")).filter((l) => l.kind === "letter");
    expect(written).toHaveLength(1);
    expect(written[0].authorId).toBe("iyer-priya");
    expect(written[0].body).toContain("Evening chai");
    expect((await approve(s.id, "iyer-priya", IYER)).status).toBe(409);
    expect((await listDocs(IYER, "chitthi")).filter((l) => l.kind === "letter")).toHaveLength(1);
    // It is not a sealed voice letter; the family reads it as a written one.
    const res = await lettersGET(new Request("http://test/api/letters", { headers: { cookie: sessionCookie("iyer-leo", IYER) } }));
    const got = (await res.json()) as { letters: unknown[]; written: { title: string }[] };
    expect(got.letters).toEqual([]);
    expect(got.written.map((l) => l.title)).toEqual(["A letter from the courtyard"]);
  });

  it("a payload that fails the schema is refused and the claim is given back", async () => {
    const bad = await dbAddSuggestion({ familyId: FAM, goal: "Send this week's letter?", payload: { action: "weekly_letter", title: "", body: "x", lang: "fr" } });
    expect((await approve(bad.id)).status).toBe(400);
    expect((await dbListSuggestions("pending", FAM)).some((x) => x.id === bad.id)).toBe(true);
  });

  it("the scan makes at most one letter per family per week, and none for a quiet week", async () => {
    await addIyerCards(2);
    expect(((await (await scan()).json()) as { letters: number }).letters).toBe(0);
    expect(await letterSuggestions(IYER)).toHaveLength(0);
    await addIyerCards(3);
    expect(((await (await scan()).json()) as { letters: number }).letters).toBe(1);
    expect(((await (await scan()).json()) as { letters: number }).letters).toBe(0);
    expect(await letterSuggestions(IYER)).toHaveLength(1);
    // A declined week is not asked again by the scan.
    const [s] = await letterSuggestions(IYER);
    await approve(s.id, "iyer-priya", IYER, { decision: "reject" });
    await scan();
    expect(await letterSuggestions(IYER)).toHaveLength(1);
  });

  it("the manual route needs a session and a grown-up, and answers with the same letter the second time", async () => {
    expect((await weeklyPOST(new Request("http://test/api/letters/weekly", { method: "POST" }))).status).toBe(401);
    await addIyerCards(1);
    expect((await weeklyPOST(post("http://test/api/letters/weekly", "iyer-leo", IYER))).status).toBe(403);
    const first = await weeklyPOST(post("http://test/api/letters/weekly", "iyer-priya", IYER));
    expect(first.status).toBe(201);
    const a = (await first.json()) as { suggestion: { id: string; goal: string } };
    expect(a.suggestion.goal).toBe("Send this week's letter?");
    const second = (await (await weeklyPOST(post("http://test/api/letters/weekly", "iyer-priya", IYER))).json()) as { suggestion: { id: string }; existing?: boolean };
    expect(second.existing).toBe(true);
    expect(second.suggestion.id).toBe(a.suggestion.id);
    expect(await letterSuggestions(IYER)).toHaveLength(1);
  });
});
