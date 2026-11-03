import { beforeEach, describe, expect, it } from "vitest";
import { POST as sessionPost } from "@/app/api/session/route";
import { clearAuthAttempts } from "@/lib/otp";
import { resetDemo } from "@/lib/store";

const signIn = (inviteCode: string, memberId = "arjun") =>
  sessionPost(new Request("http://test/api/session", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" }, body: JSON.stringify({ inviteCode, memberId }) }));

describe("demo sign-in allowance", () => {
  beforeEach(() => {
    resetDemo();
    clearAuthAttempts();
  });

  it("a room of judges on one network all get into the demo", async () => {
    for (let i = 0; i < 40; i++) expect((await signIn("NEARER-DEMO")).status).not.toBe(429);
  });

  it("guessing real invite codes from one address is still slowed down", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await signIn(`WRONG-${i}`, `m${i}`)).status);
    expect(statuses).toContain(429);
  });
});
