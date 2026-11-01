// Provider-agnostic outbound mail. With RESEND_API_KEY set (and not MOCK) it
// sends through Resend over fetch; otherwise it only logs and says so, and the
// caller keeps the message in-app. Server only; no dependency.
export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailResult {
  /** "email" when the provider took it; "inapp" when mail is not configured or it failed. */
  channel: "email" | "inapp";
}

export function mailConfigured(): boolean {
  return process.env.MOCK !== "true" && Boolean(process.env.RESEND_API_KEY);
}

export async function sendMail(m: MailInput): Promise<MailResult> {
  if (!mailConfigured()) {
    console.log(`[mail] not sent (no mail provider): ${m.subject}`); // never the address or body
    return { channel: "inapp" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM || "Nearer <onboarding@resend.dev>", to: [m.to], subject: m.subject, html: m.html, text: m.text }),
    });
    if (!res.ok) {
      console.error("[mail] provider refused", res.status);
      return { channel: "inapp" };
    }
    return { channel: "email" };
  } catch (e) {
    console.error("[mail] send failed", String(e));
    return { channel: "inapp" };
  }
}
