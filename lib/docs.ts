// Reads the generated build docs (docs/site/*.md). Used at build time only: /docs pages are prerendered,
// so nothing reads the file system on Workers.
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { DOC_PAGES } from "./docs-pages.mjs";

export interface DocPage {
  slug: string;
  /** The page's own H1, or the configured title when the file is missing. */
  title: string;
  markdown: string;
}

export const DOC_SLUGS: string[] = DOC_PAGES.map((p) => p.slug);

const MISSING = "This page has not been written yet. Run `npm run docs:muse` to generate it.";

export function titleOf(markdown: string, fallback: string): string {
  return /^# (.+)$/m.exec(markdown)?.[1].trim() ?? fallback;
}

export function loadDocPage(slug: string, dir = join(process.cwd(), "docs", "site")): DocPage | null {
  const meta = DOC_PAGES.find((p) => p.slug === slug);
  if (!meta) return null;
  const file = join(dir, `${slug}.md`);
  const markdown = existsSync(file) ? readFileSync(file, "utf8") : `# ${meta.title}\n\n${MISSING}\n`;
  return { slug, title: titleOf(markdown, meta.title), markdown };
}

export function loadAllDocPages(dir?: string): DocPage[] {
  return DOC_SLUGS.map((s) => loadDocPage(s, dir)!).filter(Boolean);
}
