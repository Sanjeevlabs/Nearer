import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { COURSE_LOOK, RecipeCover, minutes, totalTime } from "@/components/recipe-art";
import { countView, getShare } from "@/lib/shares";

// A recipe someone chose to share outside their family. Public, read-only,
// a frozen copy: no family names beyond what the card says, no voices, no
// photos of people. The quiet invitation at the end is the whole growth loop.

export const dynamic = "force-dynamic";

/** This request's own origin, so og:image is absolute on any host (workers.dev, the custom domain, localhost). */
async function originOf(): Promise<URL | undefined> {
  if (process.env.APP_ORIGIN) {
    try {
      return new URL(process.env.APP_ORIGIN);
    } catch {
      /* fall through to the request's host */
    }
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN) : undefined;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  try {
    return new URL(`${proto}://${host}`);
  } catch {
    return undefined;
  }
}

export async function generateMetadata(props: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const params = await props.params;
  const [share, metadataBase] = await Promise.all([getShare(params.token), originOf()]);
  if (!share) return { title: "Nearer", metadataBase, robots: { index: false } };
  const r = share.snapshot;
  const title = `${r.title}, from ${r.from}'s kitchen`;
  const description = r.memory || `A family recipe from ${r.from}, shared on Nearer.`;
  return {
    title: `${r.title} · from ${r.from}'s kitchen`,
    description,
    metadataBase,
    robots: { index: false, follow: false },
    openGraph: { type: "article", siteName: "Nearer", title, description, url: `/r/${params.token}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharedRecipe(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const share = await getShare(params.token);
  if (!share) {
    return (
      <div className="pt-20 text-center">
        <p className="m-0 text-title font-semibold">This recipe is no longer shared</p>
        <p className="mx-auto mt-2 max-w-[300px] text-body text-ink-soft">The family that shared it has taken it back. Recipes stay with the people who make them.</p>
      </div>
    );
  }
  await countView(params.token);
  const r = share.snapshot;
  const look = COURSE_LOOK[r.course];
  const stats = [
    ["Prep", minutes(r.prepMins)],
    ["Cook", minutes(r.cookMins)],
    ["Serves", r.serves],
  ].filter(([, v]) => v);
  return (
    <article className="pb-10 pt-2">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 text-ink no-underline" aria-label="Nearer home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={32} height={32} className="rounded-[9px]" />
          <span className="text-headline font-semibold">Nearer</span>
        </Link>
        <Link href="/" className="press flex h-10 items-center rounded-full bg-accent px-4 text-callout font-semibold text-accent-ink no-underline">
          Start your family on Nearer
        </Link>
      </div>
      <RecipeCover recipe={r} className="h-[220px] rounded-hero" />
      <p className="m-0 mt-5 text-footnote font-semibold uppercase tracking-[0.08em]" style={{ color: look.ink }}>
        {look.label}
        {totalTime(r) ? ` · ${totalTime(r)}` : ""}
      </p>
      <h1 data-display className="m-0 mt-1 text-display leading-[1.08]">{r.title}</h1>
      <p className="m-0 mt-2 text-body text-ink-soft">From {r.from}&rsquo;s kitchen</p>
      {r.memory && <p className="voice m-0 mt-4 text-title leading-snug">&ldquo;{r.memory}&rdquo;</p>}
      {stats.length > 0 && (
        <dl className="m-0 mt-5 grid divide-x divide-[var(--line)] rounded-card bg-surface py-3" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
          {stats.map(([k, v]) => (
            <div key={k} className="px-2 text-center">
              <dt className="text-caption font-medium text-ink-soft">{k}</dt>
              <dd className="m-0 mt-0.5 text-body font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {r.prepWork.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-title">Before you start</h2>
          <ul className="m-0 list-disc space-y-1.5 pl-5 text-body">
            {r.prepWork.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </>
      )}
      <h2 className="mb-3 mt-8 text-title">Ingredients</h2>
      <ul className="m-0 list-none divide-y divide-[var(--line)] rounded-card bg-surface p-0 px-4">
        {r.ingredients.map((i, n) => (
          <li key={n} className="flex items-baseline justify-between gap-3 py-3">
            <span className="text-body font-semibold">{i.item}</span>
            <span className="text-right">
              {i.said && <span className="voice block text-body">{i.said}</span>}
              {i.approx && <span className="tnum block text-footnote text-ink-faint">{i.approx}</span>}
            </span>
          </li>
        ))}
      </ul>
      <h2 className="mb-3 mt-8 text-title">Method</h2>
      <ol className="m-0 list-none space-y-5 p-0">
        {r.steps.map((st, n) => (
          <li key={n} className="flex gap-3.5">
            <span className="tnum grid h-8 w-8 shrink-0 place-items-center rounded-full text-callout font-bold text-white" style={{ background: look.ink }}>
              {n + 1}
            </span>
            <div className="pt-1">
              <p className="m-0 text-headline leading-snug">{st.text}</p>
              {st.tip && <p className="voice m-0 mt-1.5 text-headline text-[#8a4b00]">&ldquo;{st.tip}&rdquo; — {r.from}</p>}
            </div>
          </li>
        ))}
      </ol>
      {r.outcome && (
        <div className="mt-8 rounded-card p-4" style={{ background: look.bg }}>
          <p className="m-0 text-footnote font-semibold uppercase tracking-[0.06em]" style={{ color: look.ink }}>
            How you know it&rsquo;s right
          </p>
          <p className="m-0 mt-1 text-headline leading-snug">{r.outcome}</p>
        </div>
      )}
      <aside className="mt-10 rounded-hero bg-[linear-gradient(135deg,#1c1712,#3a2a1c)] p-6 text-white">
        <p className="m-0 text-title font-semibold leading-snug">Whose cooking do you miss?</p>
        <p className="m-0 mt-1.5 text-body text-white/80">Nearer keeps your family&rsquo;s recipes in the voices that taught them, private to your family.</p>
        <Link href="/" className="press mt-4 flex h-12 items-center justify-center rounded-full bg-white text-body font-semibold text-ink no-underline">
          Start your family on Nearer
        </Link>
      </aside>
    </article>
  );
}
