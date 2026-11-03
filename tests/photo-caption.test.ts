// A photo gets a Muse caption before it is posted (the person edits or clears it); a cleared
// caption stays cleared, and a photo posted without one is still captioned as before.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as postCaption } from "@/app/api/cards/caption/route";
import { POST as postCard } from "@/app/api/cards/route";
import { listCards, resetDemo } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const media = () => new Blob([PNG], { type: "image/png" });

describe("photo captions", () => {
  beforeEach(() => resetDemo());

  it("suggests a caption for one photo (mock: canned), nothing stored", async () => {
    const form = new FormData();
    form.append("media", media(), "photo.png");
    const before = listCards().length;
    const res = await postCaption(new Request("http://t/api/cards/caption", { method: "POST", headers: { cookie: sessionCookie("arjun") }, body: form }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { caption: string }).caption).toBe("A warm family moment, kept close.");
    expect(listCards().length).toBe(before);
  });

  it("needs a session and an image", async () => {
    const form = new FormData();
    form.append("media", media(), "photo.png");
    expect((await postCaption(new Request("http://t/api/cards/caption", { method: "POST", body: form }))).status).toBe(401);
    const bad = new FormData();
    bad.append("media", new Blob(["x"], { type: "text/plain" }), "a.txt");
    expect((await postCaption(new Request("http://t/api/cards/caption", { method: "POST", headers: { cookie: sessionCookie("arjun") }, body: bad }))).status).toBe(400);
  });

  const upload = (extra: Record<string, string>) => {
    const form = new FormData();
    form.append("type", "photo");
    form.append("caption", "");
    form.append("lang", "en");
    form.append("takenAt", "2021-10-27T09:15:00.000Z");
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    form.append("media", media(), "media");
    return postCard(new Request("http://t/api/cards", { method: "POST", headers: { cookie: sessionCookie("arjun") }, body: form }));
  };

  it("a caption the person cleared stays empty; an unseen one is still written by Muse", async () => {
    const cleared = (await (await upload({ captionFinal: "1" })).json()) as { card: { caption: string } };
    expect(cleared.card.caption).toBe("");
    const auto = (await (await upload({})).json()) as { card: { caption: string } };
    expect(auto.card.caption).toBe("A warm family moment, kept close.");
  });
});
