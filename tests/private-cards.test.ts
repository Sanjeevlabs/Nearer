import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as cardsGet, POST as cardsPost } from "@/app/api/cards/route";
import { PATCH as cardPatch } from "@/app/api/cards/[id]/route";
import { GET as mediaGet } from "@/app/api/media/[...path]/route";
import { GET as mockBytesGet } from "@/app/api/media/mock-bytes/route";
import { GET as playsGet, POST as playsPost } from "@/app/api/plays/route";
import { GET as reactionsGet, POST as reactionsPost } from "@/app/api/reactions/route";
import { GET as inboxGet } from "@/app/api/inbox/route";
import { GET as sentGet } from "@/app/api/inbox/sent/route";
import { GET as exportGet } from "@/app/api/export/route";
import { GET as bookGet } from "@/app/api/book/route";
import { GET as albumsGet } from "@/app/api/albums/route";
import { GET as laneGet } from "@/app/api/lane/route";
import { POST as starsPost } from "@/app/api/stars/route";
import { canSeeCard, privateLabel, seenBy } from "@/lib/card-privacy";
import { loadArchive } from "@/lib/archive-ask";
import { windowState } from "@/lib/window-server";
import { mockPutBlob } from "@/lib/storage";
import { addCard, addPlay, listMembers, resetDemo, setReaction } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

// A note Arjun (A) sent to Dadi (B) is theirs: Kavya (C) cannot see, fetch, play or find it anywhere.
const A = "arjun";
const B = "dadi";
const C = "kavya";
const PATH = "demo-family/uploads/private-note.webm";
const NOTE = "private-note-a-to-b";
const PUBLIC = "family-note-a";

const get = (url: string, member: string) => new Request(`http://test${url}`, { headers: { cookie: sessionCookie(member) } });
const send = (url: string, member: string, body: unknown, method = "POST") =>
  new Request(`http://test${url}`, { method, headers: { "content-type": "application/json", cookie: sessionCookie(member) }, body: JSON.stringify(body) });
const text = async (r: Response | Promise<Response>) => JSON.stringify(await (await r).json());

beforeEach(() => {
  resetDemo();
  mockPutBlob(PATH, new Uint8Array([1, 2, 3, 4]), "audio/webm");
  const now = new Date(Date.now() - 60_000).toISOString();
  addCard({ id: NOTE, familyId: "demo-family", type: "audio", caption: "Only for Maa", lang: "en", takenAt: now, authorId: A, addressedTo: B, mediaRef: `storage:${PATH}`, transcript: "Maa the secret pickle recipe stays between us" });
  addCard({ id: PUBLIC, familyId: "demo-family", type: "audio", caption: "Hello everyone", lang: "en", takenAt: now, authorId: A, transcript: "Hello everyone at home" });
  addPlay({ id: "play-b-note", familyId: "demo-family", cardId: NOTE, memberId: B, playedAt: now });
  setReaction({ id: "react-b-note", familyId: "demo-family", cardId: NOTE, memberId: B, kind: "love", createdAt: now });
});

describe("who may see a card", () => {
  it("a card with no addressee is the family's; an addressed one is its author's and its people's", () => {
    const note = { authorId: A, addressedTo: `${B},priya` };
    expect(canSeeCard({ authorId: A, addressedTo: null }, C)).toBe(true);
    expect(canSeeCard({ authorId: A, addressedTo: null }, null)).toBe(true);
    expect(canSeeCard(note, A)).toBe(true);
    expect(canSeeCard(note, B)).toBe(true);
    expect(canSeeCard(note, "priya")).toBe(true);
    expect(canSeeCard(note, C)).toBe(false);
    expect(canSeeCard(note, null)).toBe(false);
    expect(seenBy([note, { authorId: A, addressedTo: null }], C)).toHaveLength(1);
  });

  it("labels a private note for the people who can see it", () => {
    const members = listMembers().filter((m) => m.familyId === "demo-family");
    const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName;
    expect(privateLabel({ authorId: A, addressedTo: B }, B, members)).toBe("Just for you");
    expect(privateLabel({ authorId: A, addressedTo: B }, A, members)).toBe(`Just for ${nameOf(B)}`);
    expect(privateLabel({ authorId: A, addressedTo: `${B},priya` }, B, members)).toBe(`Just for you and ${nameOf("priya")}`);
    expect(privateLabel({ authorId: A, addressedTo: B }, C, members)).toBeNull();
    expect(privateLabel({ authorId: A, addressedTo: null }, B, members)).toBeNull();
  });
});

describe("a note A sent to B, through every endpoint", () => {
  it("the shelf (Memory Lane, PersonDay, search, stories rows all read it)", async () => {
    for (const who of [A, B]) expect(await text(cardsGet(get("/api/cards", who)))).toContain(NOTE);
    const forC = await text(cardsGet(get("/api/cards", C)));
    expect(forC).not.toContain(NOTE);
    expect(forC).not.toContain("secret pickle");
    expect(forC).toContain(PUBLIC);
  });

  it("the card itself", async () => {
    expect((await cardPatch(send(`/api/cards/${NOTE}`, C, { caption: "x" }, "PATCH"), { params: Promise.resolve({ id: NOTE }) })).status).toBe(404);
    expect((await cardPatch(send(`/api/cards/${NOTE}`, A, { caption: "Only for Maa, still" }, "PATCH"), { params: Promise.resolve({ id: NOTE }) })).status).toBe(200);
  });

  it("its media: no signed URL and no bytes for C", async () => {
    const props = { params: Promise.resolve({ path: PATH.split("/") }) };
    expect((await mediaGet(get(`/api/media/${PATH}`, C), props)).status).toBe(404);
    for (const who of [A, B]) expect((await mediaGet(get(`/api/media/${PATH}`, who), { params: Promise.resolve({ path: PATH.split("/") }) })).status).toBe(307);
    const bytes = (who: string) => mockBytesGet(get(`/api/media/mock-bytes?path=${encodeURIComponent(PATH)}`, who));
    expect((await bytes(C)).status).toBe(404);
    expect((await bytes(B)).status).toBe(200);
    expect((await bytes(A)).status).toBe(200);
  });

  it("plays and reactions: C cannot play, react, or see who did", async () => {
    expect((await playsPost(send("/api/plays", C, { cardId: NOTE, memberId: C }))).status).toBe(404);
    expect((await playsPost(send("/api/plays", B, { cardId: NOTE, memberId: B }))).status).toBe(201);
    expect(await text(playsGet(get(`/api/plays?cardId=${NOTE}`, C)))).not.toContain(NOTE);
    expect(await text(playsGet(get(`/api/plays?cardId=${NOTE}`, A)))).toContain(NOTE);
    expect((await reactionsPost(send("/api/reactions", C, { cardId: NOTE, memberId: C, kind: "love" }))).status).toBe(404);
    expect(await text(reactionsGet(get("/api/reactions", C)))).not.toContain(NOTE);
    expect(await text(reactionsGet(get("/api/reactions", A)))).toContain(NOTE);
    expect((await starsPost(send("/api/stars", C, { cardId: NOTE }))).status).toBe(404);
  });

  it("inbox and sent", async () => {
    expect(await text(inboxGet(get("/api/inbox", B)))).toContain(NOTE);
    expect(await text(inboxGet(get("/api/inbox", C)))).not.toContain(NOTE);
    expect(await text(sentGet(get("/api/inbox/sent", A)))).toContain(NOTE);
  });

  it("search (ask the family's words)", async () => {
    const quoted = async (who: string) => (await loadArchive("demo-family", who)).snippets.some((s) => s.cardId === NOTE);
    expect(await quoted(C)).toBe(false);
    expect(await quoted(B)).toBe(true);
    expect(await quoted(A)).toBe(true);
  });

  it("export, the book, albums and the lane's other-tab ids", async () => {
    expect(await text(exportGet(get("/api/export", C)))).not.toContain(NOTE);
    expect(await text(exportGet(get("/api/export", B)))).toContain(NOTE);
    expect(await text(bookGet(get(`/api/book?member=${A}`, C)))).not.toContain(NOTE);
    expect(await text(albumsGet(get("/api/albums", C)))).not.toContain(NOTE);
    expect(await text(laneGet(get("/api/lane", C)))).not.toContain(NOTE);
  });

  it("the window", async () => {
    const forC = JSON.stringify(await windowState("demo-family", C));
    expect(forC).not.toContain(NOTE);
    expect(forC).not.toContain("secret pickle");
  });
});

// Every server reader of the cards table goes through lib/card-privacy.ts (or is a count that never leaves the server).
describe("no card reader skips the gate", () => {
  const ALLOWED = new Set(["lib/db.ts", "lib/request-data.ts", "lib/metrics-server.ts"]);
  const root = join(__dirname, "..");
  const walk = (dir: string): string[] =>
    readdirSync(join(root, dir)).flatMap((f) => {
      const rel = `${dir}/${f}`;
      return statSync(join(root, rel)).isDirectory() ? walk(rel) : /\.tsx?$/.test(f) ? [rel] : [];
    });
  it("each file that lists cards also filters them by viewer", () => {
    const readers = [...walk("app"), ...walk("lib")].filter((f) => /\b(dbListCards|cardsFor)\(/.test(readFileSync(join(root, f), "utf8")));
    const ungated = readers.filter((f) => !ALLOWED.has(f) && !/card-privacy|media-gate/.test(readFileSync(join(root, f), "utf8")));
    expect(ungated).toEqual([]);
  });
});


describe("card creation and covers", () => {
  it("rejects another member's ID without changing the private card", async () => {
    const id = crypto.randomUUID();
    const original = addCard({ id, familyId: "demo-family", type: "audio", caption: "Original", lang: "en", takenAt: new Date().toISOString(), authorId: A, addressedTo: B });
    const res = await cardsPost(send("/api/cards", C, { id, type: "audio", caption: "Changed", takenAt: new Date().toISOString() }));
    expect(res.status).toBe(409);
    const retry = await cardsPost(send("/api/cards", A, { id, type: "audio", caption: "Changed", takenAt: new Date().toISOString() }));
    expect(retry.status).toBe(200);
    expect((await retry.json()).card).toEqual(original);
  });

  it("protects a private cover unless another visible card uses it", async () => {
    const path = "demo-family/uploads/private-cover.jpg";
    mockPutBlob(path, new Uint8Array([1]), "image/jpeg");
    addCard({ id: "cover-note", familyId: "demo-family", type: "audio", caption: "Private", lang: "en", takenAt: new Date().toISOString(), authorId: A, addressedTo: B, coverRef: `storage:${path}` });
    const bytes = (who: string) => mockBytesGet(get(`/api/media/mock-bytes?path=${encodeURIComponent(path)}`, who));
    expect((await bytes(C)).status).toBe(404);
    expect((await bytes(B)).status).toBe(200);
    addCard({ id: "other-cover", familyId: "demo-family", type: "audio", caption: "Shared", lang: "en", takenAt: new Date().toISOString(), authorId: A, coverRef: `storage:${path}` });
    expect((await bytes(C)).status).toBe(404);
    addCard({ id: "shared-photo", familyId: "demo-family", type: "photo", caption: "Shared", lang: "en", takenAt: new Date().toISOString(), authorId: A, mediaRef: `storage:${path}` });
    expect((await bytes(C)).status).toBe(200);
  });
});
