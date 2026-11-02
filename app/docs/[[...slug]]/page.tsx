import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lockup } from "@/components/brand";
import { DOC_PAGES } from "@/lib/docs-pages.mjs";
import { DOC_SLUGS, loadDocPage } from "@/lib/docs";
import { renderMarkdown } from "@/lib/markdown";
import "../docs.css";

// The build docs, written by Muse from the build log (npm run docs:muse) and prerendered here.
// docs.nearer.site serves the same pages at its root (see lib/docs-host.mjs and cf-worker.mjs).

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ slug: [] as string[] }, ...DOC_SLUGS.filter((s) => s !== "index").map((s) => ({ slug: [s] }))];
}

type Params = Promise<{ slug?: string[] }>;

function slugOf(slug?: string[]): string | null {
  if (!slug || slug.length === 0) return "index";
  if (slug.length === 1 && slug[0] !== "index" && DOC_SLUGS.includes(slug[0])) return slug[0];
  return null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = slugOf((await params).slug);
  const page = slug ? loadDocPage(slug) : null;
  if (!page) return {};
  return { title: `${page.title} | Nearer docs`, description: "How Nearer is built, written by Muse Spark (Meta) from the build log." };
}

const NAV_LABEL: Record<string, string> = { index: "Overview" };

export default async function DocsPage({ params }: { params: Params }) {
  const slug = slugOf((await params).slug);
  const page = slug ? loadDocPage(slug) : null;
  if (!slug || !page) notFound();
  return (
    <div className="docs-root">
      <header className="flex min-h-[44px] items-center py-2">
        <Link href="/docs" aria-label="Nearer docs" className="inline-flex min-h-[44px] items-center text-ink no-underline">
          <Lockup />
          <span className="ml-3 text-footnote text-ink-soft">Docs</span>
        </Link>
      </header>
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="Docs pages">
          <ul>
            {DOC_PAGES.map((p) => (
              <li key={p.slug}>
                <Link href={p.slug === "index" ? "/docs" : `/docs/${p.slug}`} aria-current={p.slug === slug ? "page" : undefined}>
                  {NAV_LABEL[p.slug] ?? p.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <article className="docs-article">{renderMarkdown(page.markdown)}</article>
      </div>
    </div>
  );
}
