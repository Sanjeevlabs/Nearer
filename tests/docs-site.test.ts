import { readdirSync } from "fs";
import { join } from "path";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DocsPage, { generateStaticParams } from "@/app/docs/[[...slug]]/page";
import { docsRewrite } from "@/lib/docs-host.mjs";
import { DOC_PAGES } from "@/lib/docs-pages.mjs";
import { DOC_SLUGS, loadDocPage } from "@/lib/docs";
import { renderMarkdown } from "@/lib/markdown";
import { cleanReply, sanitizeInput, validatePage, withFooter } from "@/scripts/muse-docs.mjs";

const html = (md: string) => renderToStaticMarkup(createElement(Fragment, null, ...renderMarkdown(md)));

describe("docs route", () => {
  it("prerenders the index and every other page", () => {
    const params = generateStaticParams();
    expect(params).toHaveLength(DOC_PAGES.length);
    expect(params[0]).toEqual({ slug: [] });
  });

  it("renders the index with nav, an H1 and the Muse byline", async () => {
    const out = renderToStaticMarkup(await DocsPage({ params: Promise.resolve({}) }));
    expect(out).toContain("<h1");
    expect(out).toContain("Docs pages");
    expect(out).toContain("Written by Muse Spark (Meta)");
    expect(out).toContain('href="/docs/architecture"');
  });

  it("renders a named page and marks it current", async () => {
    const out = renderToStaticMarkup(await DocsPage({ params: Promise.resolve({ slug: ["muse"] }) }));
    expect(out).toContain('aria-current="page"');
    expect(out).toContain("<h1");
  });

  it("404s an unknown page", async () => {
    await expect(DocsPage({ params: Promise.resolve({ slug: ["nope"] }) })).rejects.toThrow();
  });

  it("every configured page has a generated file with an H1 and the footer", () => {
    const files = readdirSync(join(process.cwd(), "docs", "site")).filter((f) => f.endsWith(".md"));
    expect(files.sort()).toEqual(DOC_SLUGS.map((s) => `${s}.md`).sort());
    for (const s of DOC_SLUGS) {
      const p = loadDocPage(s)!;
      expect(p.markdown).toMatch(/^# \S/m);
      expect(p.markdown).toMatch(/Written by Muse Spark \(Meta\) from the build log on \d{4}-\d{2}-\d{2}\.\s*$/);
    }
  });

  it("committed pages pass the validator", () => {
    for (const s of DOC_SLUGS) expect(validatePage(loadDocPage(s)!.markdown)).toEqual([]);
  });
});

describe("host rewrite", () => {
  it("maps docs.nearer.site to /docs", () => {
    expect(docsRewrite("docs.nearer.site", "/")).toBe("/docs");
    expect(docsRewrite("docs.nearer.site", "/architecture")).toBe("/docs/architecture");
    expect(docsRewrite("docs.nearer.site", "/muse/")).toBe("/docs/muse");
    expect(docsRewrite("DOCS.nearer.site", "/x")).toBe("/docs/x");
  });
  it("leaves assets, the API and /docs links alone on the docs host", () => {
    for (const p of ["/_next/static/a.js", "/brand/mark.svg", "/api/muse", "/docs/muse", "/favicon.ico"]) expect(docsRewrite("docs.nearer.site", p)).toBeNull();
  });
  it("leaves every other host untouched", () => {
    for (const h of ["nearer.site", "www.nearer.site", "localhost:3000", "docs.nearer.site.evil.com", "", null]) expect(docsRewrite(h, "/privacy")).toBeNull();
  });
});

describe("generator validator", () => {
  const good = "# Title\n\n" + "A plain sentence about the app. ".repeat(12);
  it("accepts a clean page", () => expect(validatePage(good)).toEqual([]));
  it("rejects empty text and a missing H1", () => {
    expect(validatePage("")).not.toEqual([]);
    expect(validatePage("No heading here. ".repeat(20))).toContain("no H1");
  });
  it("rejects secret-like and strategy strings", () => {
    for (const bad of ["LLM_" + "1234567890", "sk" + "-abcdefgh12345", "cfut" + "_abc", "the pri" + "ce of it", "annual reve" + "nue", "an inves" + "tor deck", "a compe" + "titor app"])
      expect(validatePage(`${good}\n${bad}`).length, bad).toBeGreaterThan(0);
  });
  it("does not trip on ordinary words that contain sk-", () => expect(validatePage(`${good}\nA risk-based, task-based check.`)).toEqual([]));
  it("rejects a page that contains the live key value", () => expect(validatePage(`${good}\nkey-value-123`, ["key-value-123"])).toContain("contains a secret value"));
  it("drops source lines that would be rejected", () => expect(sanitizeInput("fine\nour compe" + "titor list\nalso fine")).toBe("fine\nalso fine"));
  it("strips a code fence and a model-written footer, then adds ours", () => {
    expect(cleanReply("```markdown\n# T\n\nbody\n```")).toBe("# T\n\nbody");
    expect(cleanReply("# T\n\nbody\n\n---\n\nWritten by Muse Spark on today.")).toBe("# T\n\nbody");
    expect(withFooter("# T", "2026-11-02")).toBe("# T\n\n---\n\nWritten by Muse Spark (Meta) from the build log on 2026-11-02.\n");
  });
});

describe("markdown renderer", () => {
  it("renders headings, lists, code and tables", () => {
    const out = html("# A\n\n## B\n\n- one\n- two\n\n1. x\n2. y\n\n```\ncode <b>\n```\n\n| H1 | H2 |\n|---|---|\n| a | b |\n");
    expect(out).toContain('<h1 id="a">A</h1>');
    expect(out).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(out).toContain("<ol><li>x</li><li>y</li></ol>");
    expect(out).toContain("<code>code &lt;b&gt;</code>");
    expect(out).toContain("<th>H1</th>");
    expect(out).toContain("<td>b</td>");
  });
  it("renders inline code, bold, italic and links", () => {
    const out = html("Use `npm run x`, **bold**, *it* and [home](/docs/muse).");
    expect(out).toContain("<code>npm run x</code>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>it</em>");
    expect(out).toContain('<a href="/docs/muse">home</a>');
  });
  it("never emits raw HTML or unsafe links", () => {
    const out = html("<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n[y](//evil.com)");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain('href="//evil');
  });
  it("nests one level of list items", () => {
    expect(html("- a\n  - b\n- c")).toContain("<li>a<ul><li>b</li></ul></li>");
  });
});
