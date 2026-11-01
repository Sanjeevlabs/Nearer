# Deploying Nearer to Cloudflare Workers

Nearer runs on Cloudflare Workers through the OpenNext adapter (`@opennextjs/cloudflare`). `npm run build` is still a plain `next build`; the Workers build is separate.

| Script | What it does |
|---|---|
| `npm run cf:build` | `next build`, then adapts the output into `.open-next/` (worker + static assets) |
| `npm run cf:preview` | build, then run the worker locally in workerd (wrangler dev) on http://localhost:8787 |
| `npm run cf:deploy` | build, then upload to Cloudflare |

Files: `wrangler.jsonc` (worker name `aangan`, `nodejs_compat`, static assets, daily cron), `open-next.config.ts` (adapter config), `cf-worker.mjs` (worker entry: OpenNext's handler plus the cron handler).

## 1. Account and CLI

1. Create a Cloudflare account. Worker size: the compressed worker is ~2.9 MiB (`npx wrangler deploy --dry-run`), under both Workers size limits (3 MiB and 10 MiB compressed, depending on the plan); see section 7.
2. `npx wrangler login` (opens a browser; authorises this machine).
3. `npx wrangler whoami` should list your account. If you have several accounts, set `CLOUDFLARE_ACCOUNT_ID` in your shell.

## 2. Variables and secrets

Nothing secret lives in `wrangler.jsonc`. There are two kinds of variable:

- **Runtime** (read by server code via `process.env`; OpenNext fills `process.env` from the worker's bindings on each request). Set them as secrets: `npx wrangler secret put NAME` (prompts for the value), or in the dashboard under Workers & Pages → aangan → Settings → Variables and Secrets. Plain values can be "Text" variables; keys must be "Secret".
- **Build time** (`NEXT_PUBLIC_*`): Next.js inlines these into the browser bundle during `next build`, so they must be in the environment **of the machine that runs `npm run cf:build`/`cf:deploy`** (shell env or a `.env.production.local` that is never committed). Setting them only as worker secrets does nothing. If you use Cloudflare Workers Builds (Git integration), set them under the build's "Build variables".

For local `cf:preview`, put runtime values in `.dev.vars` (gitignored, same `KEY=value` format as `.env`).

| Variable | Kind | Required | Notes |
|---|---|---|---|
| `SESSION_SECRET` | runtime secret | yes | 32+ random chars. Signs session cookies and seals partner tokens. |
| `CRON_SECRET` | runtime secret | yes | Long random string. The daily cron and any manual GET of `/api/ritual-scan` send `Authorization: Bearer <CRON_SECRET>`. |
| `APP_ORIGIN` | runtime var | yes in production | Your public origin, e.g. `https://nearer.site` (no trailing slash). Pins OAuth redirect URIs and is the URL the cron calls. Not hardcoded anywhere. |
| `MOCK` | runtime var | yes | `false` for live Supabase; `true` only for a demo (see per-isolate note below). |
| `META_API_KEY` | runtime secret | for live AI | Meta model calls. Environment only, never in a file. |
| `BASETEN_API_KEY` | runtime secret | optional | Muse Spark Open failover on Baseten. |
| `MODAL_MUSE_URL`, `MODAL_API_KEY`, `MODAL_MUSE_MODEL` | runtime (key is secret) | optional | Own Muse Spark Open endpoint on Modal; needs URL and key. |
| `MUSE_PROVIDER` | runtime var | optional | `meta` (default), `baseten` or `modal`. |
| `SAM_URL`, `SAM_API_KEY` | runtime (key is secret) | optional | Sticker cut-outs with Meta SAM (`modal/sam_server.py`, see below). Without both, and always with `MOCK=true`, stickers use a clean circle/rounded crop. Each cut-out counts ~USD 0.002 against the spend cap. |
| `JAAS_APP_ID`, `JAAS_KID`, `JAAS_PRIVATE_KEY` | runtime (key is secret) | optional | Video rooms on 8x8 Jitsi as a Service, so grandparents never meet a moderator sign-in. All three or none; without them "Sit together" uses public meet.jit.si. See the JaaS section below. |
| `RESEND_API_KEY`, `MAIL_FROM` | runtime (key is secret) | optional | The morning email: one digest a day per person (the weekly letter on Sunday, plus up to 3 small nudges a week), sent through Resend. `MAIL_FROM` like `Nearer <hello@yourdomain>` on a verified domain. Without the key, or with `MOCK=true`, nothing is mailed and nudges show only in the app. Delivery happens when the daily scan runs after each person's 8 AM; with one daily cron (09:00 UTC) a nudge waits for the next run, so an hourly trigger gives true 8 AM local. |
| `SUPABASE_SECRET_KEY` | runtime secret | live mode | Service-role key. Never prefix with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_SUPABASE_URL` | **build time** | live mode | Also read server-side, so set it as a runtime var too. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **build time** | live mode | Also set as a runtime var. |
| `NEXT_PUBLIC_AUTH_GOOGLE` | **build time** | optional | `true` shows Google sign-in. |
| `NEXT_PUBLIC_AUTH_PHONE` | **build time** | optional | `true` only with an SMS provider configured in Supabase. |
| `NEXT_PUBLIC_MOCK` | **build time** | optional | `true` with `MOCK=true` so the browser uses the demo code instead of Supabase. |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | **build time** | optional | Browser key; restrict it to your domain in Google Cloud. |
| `PARTNER_SWIGGY`, `PARTNER_ZOMATO`, `PARTNER_URBAN_COMPANY`, `PARTNER_SHOPIFY_GIFTS` | runtime var | optional | `true` turns a partner on (`data/partners.json`). |
| `SWIGGY_CLIENT_ID`, `ZOMATO_CLIENT_ID` | runtime var | optional | Pre-registered OAuth client ids, if a partner needs one. |
| `UCP_AGENT_PROFILE` | runtime var | optional | Overrides the UCP agent profile sent to Shopify. |

Example:

```sh
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CRON_SECRET
npx wrangler secret put META_API_KEY
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put APP_ORIGIN      # e.g. https://nearer.site
npx wrangler secret put MOCK            # false
# build-time values, then deploy
export NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... NEXT_PUBLIC_AUTH_GOOGLE=true
npm run cf:deploy
```

(`NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` also need `wrangler secret put` so server routes see them.)

## 3. First deploy

`npm run cf:deploy` creates the worker on first run and prints its `*.workers.dev` URL. Open it and check the home page, then `/?demo=1` on a phone.

## 4. Custom domain

Dashboard → Workers & Pages → aangan → Settings → Domains & Routes → Add → Custom domain. The domain's DNS must be on Cloudflare (add the site to your account first). Cloudflare issues the certificate. Then set `APP_ORIGIN` to `https://<that-domain>` (e.g. `https://nearer.site`) and redeploy (or just update the secret).

## 5. Supabase

Supabase → Authentication → URL Configuration:

- **Site URL**: `https://<your-domain>` (same as `APP_ORIGIN`).
- **Redirect URLs**: add `https://<your-domain>/auth/callback`, the `https://aangan.<subdomain>.workers.dev/auth/callback` URL if you use it, and the native app's `site.nearer.app://auth/callback`.
- Google provider: enable under Authentication → Providers (its own redirect URI stays Supabase's).

Native builds: `CAP_SERVER_URL=https://<your-domain> npm run cap:sync` (see docs/NATIVE.md).

## 6. Sticker cut-outs (Meta SAM on Modal)

`modal/sam_server.py` serves SAM 2.1 (`facebook/sam2.1-hiera-large`) or SAM 3 (`SAM_MODEL=facebook/sam3`, gated: accept the licence on Hugging Face with the account behind `HF_TOKEN`) on a GPU that scales to zero after two idle minutes.

```sh
pip install modal && modal setup
modal secret create aangan-sam SAM_API_KEY=<long random string> HF_TOKEN=<hf token>
modal deploy modal/sam_server.py
npx wrangler secret put SAM_URL       # https://<workspace>--aangan-sam-cutout.modal.run
npx wrangler secret put SAM_API_KEY   # the same random string
```

The app's `/api/stickers/cutout` sends only the photo the person picked (their own; a recipe's dish) and the point they tapped, gets a PNG mask back, and stores nothing. It is limited to 6 cut-outs a minute per person (per isolate) and refuses past the USD spend cap.

## 7. Open Graph images

Link previews use static images (`app/opengraph-image.png`, `app/r/[token]/opengraph-image.png`); the recipe page's title and description are still per recipe. A per-recipe image rendered with `next/og` adds ~0.6 MiB gzip to the Worker, which does not fit the Free plan's 3 MiB limit alongside the app (Paid allows 10 MiB). Set `APP_ORIGIN` in the build environment too so `og:image` URLs are absolute.

## 8. Cron

`wrangler.jsonc` declares a Cron Trigger (`0 9 * * *`, UTC), replacing the `crons` entry in `vercel.json`. `cf-worker.mjs` handles it by calling `GET <APP_ORIGIN>/api/ritual-scan` inside the worker with `Authorization: Bearer <CRON_SECRET>`. Test locally with `npx wrangler dev --test-scheduled` and `curl "http://localhost:8787/__scheduled?cron=0+9+*+*+*"`. Cron Triggers run in the dashboard under the worker's Settings → Triggers.

## Things that behave differently on Workers

- **In-memory state is per isolate.** Cloudflare runs many short-lived isolates, so anything kept in module memory is not shared and can reset at any time:
  - the **mock store** (`MOCK=true`): a demo still opens (every isolate seeds the same synthetic families), but writes made in one request may be missing in the next;
  - the **USD 120 spend ledger** and the **model cache** (`lib/llm-server.ts`): with a live database the cap is global (`spend_total` + `add_spend` in `supabase/schema.sql`, re-read at most every 10 s, so overshoot is at most a few calls); cached outputs may be recomputed per isolate. Keep a provider-side budget alert on each model key as a second stop;
  - **rate limits** (OTP and per-session model routes, `lib/auth.ts`) and the partner OAuth hand-off map (`lib/partners/oauth.ts`) are also per isolate.
  Moving these to KV/Durable Objects/Supabase is a later change; nothing was redesigned for this port.
- **No filesystem at runtime.** Ritual configs are bundled through `rituals/index.ts` (a test keeps it in step with `rituals/*.json`).
- **Images are not optimised.** Workers has no built-in Next.js image optimizer; `next.config.mjs` sets `images.unoptimized`, so the few bundled demo photos are served as-is from static assets (edge-cached). To optimise later, add Cloudflare Images (`"images": { "binding": "IMAGES" }` in `wrangler.jsonc`, see opennext.js.org/cloudflare/howtos/image) and remove `unoptimized`.
- **No ISR.** `open-next.config.ts` serves prerendered pages from static assets; Nearer uses no revalidation, so no R2/KV cache bucket is needed. If revalidation is ever added, switch to the R2 incremental cache.
- `node:crypto` (HMAC, SHA-256, AES-256-GCM, `randomBytes`, `randomInt`) and `Buffer` work under `nodejs_compat`.
- Request bodies: Workers accepts request bodies of at least 100 MB, above the app's own 25 MB video limit.

## Sit together on JaaS (optional)

Public meet.jit.si makes the first person sign in as moderator. 8x8 Jitsi as a Service (free tier) does not.

1. Sign in at jaas.8x8.vc. The App ID looks like `vpaas-magic-cookie-...` (`JAAS_APP_ID`).
2. API keys, then Add API key: generate a key pair and download the private key (PKCS#8 PEM). The key id shown is `vpaas-magic-cookie-.../abc123` (`JAAS_KID`).
3. `npx wrangler secret put JAAS_APP_ID`, then `JAAS_KID`, then `JAAS_PRIVATE_KEY` (paste the whole PEM; literal `\n` is accepted).

Tokens are minted per person by `GET /api/sit/token`; the private key never reaches the browser.
