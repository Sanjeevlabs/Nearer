// Makes a VAPID key pair for web push (RFC 8292) and prints it. Run once:
//   node scripts/vapid-keys.mjs
// Then store the three values as Worker secrets (see docs/NATIVE.md, "Push notifications"):
//   npx wrangler secret put VAPID_PUBLIC_KEY
//   npx wrangler secret put VAPID_PRIVATE_KEY
//   npx wrangler secret put VAPID_SUBJECT      # mailto:hello@nearer.site
// The private key is shown once, on your screen only. Never commit it or paste it in a chat or issue.
// A new pair invalidates every browser subscription made with the old one (people turn notifications on again).
import { webcrypto } from "node:crypto";

const b64u = (bytes) => Buffer.from(bytes).toString("base64url");

const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
const x = Buffer.from(jwk.x, "base64url");
const y = Buffer.from(jwk.y, "base64url");
const publicKey = b64u(Buffer.concat([Buffer.from([4]), x, y]));

console.log("VAPID_PUBLIC_KEY=" + publicKey);
console.log("VAPID_PRIVATE_KEY=" + jwk.d);
console.log("VAPID_SUBJECT=mailto:hello@nearer.site");
console.error("\nSave the private key now; it is not stored anywhere. Put each value in with `npx wrangler secret put <NAME>`.");
