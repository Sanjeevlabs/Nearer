// The one morning email: same tone as the letter, big type, one button.
// Server-rendered HTML with inline styles (mail clients ignore stylesheets).

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface DigestInput {
  name: string;
  /** Lines already resolved for this reader ("Maa heard your voice note"). */
  lines: string[];
  letter?: { title: string; body: string } | null;
  /** The app address. A signed magic link would need the auth service; the app's own sign-in handles the rest. */
  openUrl: string;
  /** wa.me link so the person who approved the letter can forward it. */
  shareUrl?: string | null;
}

/** The mark and the name, small, at the top: the one place the logo shows in a mail. */
function lockup(origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `<p style="margin:0 0 22px;font-size:17px;font-weight:700;color:#5b6470;"><img src="${esc(base)}/brand/mark-96.png" width="28" height="28" alt="" style="vertical-align:middle;margin-right:8px;border:0;"><span style="vertical-align:middle;">Nearer</span></p>`;
}

export function renderDigestEmail(d: DigestInput): { subject: string; html: string; text: string } {
  const subject = d.letter ? d.letter.title : "A little news from home";
  const lines = d.lines.map((l) => `<p style="margin:0 0 14px;font-size:22px;line-height:1.35;">${esc(l)}</p>`).join("");
  const letter = d.letter
    ? `<div style="margin:24px 0;padding:22px;border-radius:20px;background:#fbf4e4;"><p style="margin:0 0 10px;font-size:24px;line-height:1.3;font-weight:700;">${esc(d.letter.title)}</p><p style="margin:0;font-size:19px;line-height:1.5;white-space:pre-line;">${esc(d.letter.body)}</p></div>`
    : "";
  const share = d.shareUrl ? `<p style="margin:18px 0 0;font-size:17px;"><a href="${esc(d.shareUrl)}" style="color:#7a4b00;">Send this letter on WhatsApp</a></p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#fffdf8;color:#2b2118;font-family:Georgia,'Times New Roman',serif;"><div style="max-width:560px;margin:0 auto;padding:32px 22px;">${lockup(d.openUrl)}<p style="margin:0 0 20px;font-size:26px;font-weight:700;">Good morning, ${esc(d.name)}</p>${lines}${letter}<p style="margin:28px 0 0;"><a href="${esc(d.openUrl)}" style="display:inline-block;padding:16px 30px;border-radius:999px;background:#2b2118;color:#ffffff;font-size:20px;font-weight:700;text-decoration:none;">Open Nearer</a></p>${share}<p style="margin:32px 0 0;font-size:14px;color:#7b6f60;">You can change or stop these in Nearer, Settings.</p></div></body></html>`;
  const text = [`Good morning, ${d.name}`, "", ...d.lines, ...(d.letter ? ["", d.letter.title, d.letter.body] : []), "", `Open Nearer: ${d.openUrl}`, ...(d.shareUrl ? [`Send this letter on WhatsApp: ${d.shareUrl}`] : []), "", "You can change or stop these in Nearer, Settings."].join("\n");
  return { subject, html, text };
}

/** One-tap WhatsApp share of the letter: its title and the app link. */
export function letterShareLink(title: string, appUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${title}\n${appUrl}`)}`;
}
