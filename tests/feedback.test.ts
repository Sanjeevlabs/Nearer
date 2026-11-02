// "Tell us by voice": a spoken note to the Nearer team, transcribed by the usual path, kept as words only.
import { beforeEach, describe, expect, it } from "vitest";
import { DELETE as feedbackDelete, GET as feedbackGet, POST as feedbackPost } from "@/app/api/feedback/route";
import { clearRateLimits } from "@/lib/auth";
import { listDocs } from "@/lib/family-docs";
import { clearAuthAttempts } from "@/lib/otp";
import { resetDemo } from "@/lib/store";
import { authedGet, sessionCookie } from "./auth-helper";

type Note = { id: string; memberId: string; text: string; durationMs: number };
const speak = (as: string, extra: Record<string, string> = {}, bytes = 64) => {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(bytes).fill(7)], { type: "audio/wav" }), "voice.wav");
  form.append("langHint", "en");
  form.append("durationMs", "4200");
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return feedbackPost(new Request("http://t/api/feedback", { method: "POST", headers: { cookie: sessionCookie(as) }, body: form }));
};
const list = async (as: string) => (await (await feedbackGet(authedGet("http://t/api/feedback", as))).json()) as { feedback: Note[]; seesAll: boolean };

beforeEach(() => {
  resetDemo();
  clearAuthAttempts();
  clearRateLimits();
});

describe("/api/feedback", () => {
  it("transcribes a recording and keeps the words, not the audio", async () => {
    const res = await speak("dadi");
    expect(res.status).toBe(201);
    const { feedback } = (await res.json()) as { feedback: Note & { lang: string } };
    expect(feedback.memberId).toBe("dadi");
    expect(feedback.text.length).toBeGreaterThan(0);
    expect(feedback.durationMs).toBe(4200);
    const stored = (await listDocs("demo-family", "feedback"))[0];
    expect(Object.keys(stored).sort()).toEqual(["at", "durationMs", "id", "lang", "memberId", "text"]);
  });

  it("the owner or an admin reads everyone's notes; anyone else reads only their own", async () => {
    await speak("dadi");
    clearAuthAttempts();
    await speak("kavya");
    const owner = await list("arjun");
    expect(owner.seesAll).toBe(true);
    expect(owner.feedback.map((f) => f.memberId).sort()).toEqual(["dadi", "kavya"]);
    const maa = await list("dadi");
    expect(maa.seesAll).toBe(false);
    expect(maa.feedback.map((f) => f.memberId)).toEqual(["dadi"]);
  });

  it("you can take back your own note, not someone else's", async () => {
    const { feedback } = (await (await speak("dadi")).json()) as { feedback: Note };
    const del = (as: string) => feedbackDelete(new Request("http://t/api/feedback", { method: "DELETE", headers: { cookie: sessionCookie(as), "content-type": "application/json" }, body: JSON.stringify({ id: feedback.id }) }));
    expect((await del("kavya")).status).toBe(403);
    expect((await del("dadi")).status).toBe(200);
    expect((await list("arjun")).feedback).toEqual([]);
  });

  it("needs a recording, a signed-in person, and slows a flood (5 an hour)", async () => {
    expect((await feedbackPost(new Request("http://t/api/feedback", { method: "POST", body: new FormData() }))).status).toBe(401);
    const none = new FormData();
    expect((await feedbackPost(new Request("http://t/api/feedback", { method: "POST", headers: { cookie: sessionCookie("dadi") }, body: none }))).status).toBe(400);
    clearAuthAttempts();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      clearRateLimits();
      codes.push((await speak("dadi")).status);
    }
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });
});
