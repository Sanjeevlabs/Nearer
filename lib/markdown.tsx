// A small, Workers-safe Markdown renderer for the build docs: headings, paragraphs, lists (one level of
// nesting), fenced code, block quotes, rules, tables, and inline code, bold, italic and links.
// It builds React elements (never raw HTML), so page text can't inject markup. Only http(s), site-relative and
// #anchor links are kept.
import type { ReactNode } from "react";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(https?:\/\/|\/|#|mailto:)/i.test(h) && !/^\/\//.test(h) ? h : null;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/;

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    const key = `${keyPrefix}${n++}`;
    if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**") || tok.startsWith("__")) out.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = safeHref(lm[2]);
      out.push(href ? <a key={key} href={href}>{renderInline(lm[1], key)}</a> : lm[1]);
    } else out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
const splitRow = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

interface Item {
  text: string;
  children: Item[];
}

export function renderMarkdown(md: string): ReactNode[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // Fenced code
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(<pre key={k++} tabIndex={0}><code>{body.join("\n")}</code></pre>);
      continue;
    }
    // Heading
    const h = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const id = slugify(h[2]);
      const kids = renderInline(h[2], `h${k}`);
      out.push(level === 1 ? <h1 key={k++} id={id}>{kids}</h1> : level === 2 ? <h2 key={k++} id={id}>{kids}</h2> : level === 3 ? <h3 key={k++} id={id}>{kids}</h3> : <h4 key={k++} id={id}>{kids}</h4>);
      i++;
      continue;
    }
    // Rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={k++} />);
      i++;
      continue;
    }
    // Table
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
      const tk = k++;
      out.push(
        <div key={tk} className="docs-table" tabIndex={0} role="region" aria-label="Table">
          <table>
            <thead>
              <tr>{head.map((c, j) => <th key={j}>{renderInline(c, `t${tk}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{head.map((_, j) => <td key={j}>{renderInline(r[j] ?? "", `t${tk}r${ri}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    // Block quote
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(<blockquote key={k++}>{renderMarkdown(body.join("\n"))}</blockquote>);
      continue;
    }
    // List
    const li = LIST_ITEM.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const baseIndent = li[1].length;
      const items: Item[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (!m) {
          // A wrapped continuation line belongs to the last item.
          if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
            const last = items[items.length - 1].children.length ? items[items.length - 1].children.slice(-1)[0] : items[items.length - 1];
            last.text += " " + lines[i].trim();
            i++;
            continue;
          }
          break;
        }
        if (m[1].length > baseIndent + 1 && items.length) items[items.length - 1].children.push({ text: m[3], children: [] });
        else if (m[1].length < baseIndent) break;
        else items.push({ text: m[3], children: [] });
        i++;
      }
      const lk = k++;
      const body = items.map((it, j) => (
        <li key={j}>
          {renderInline(it.text, `l${lk}${j}`)}
          {it.children.length > 0 && <ul>{it.children.map((c, cj) => <li key={cj}>{renderInline(c.text, `l${lk}${j}c${cj}`)}</li>)}</ul>}
        </li>
      ));
      out.push(ordered ? <ol key={lk}>{body}</ol> : <ul key={lk}>{body}</ul>);
      continue;
    }
    // Paragraph: runs until a blank line or the start of another block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|~~~)/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
    )
      para.push(lines[i++].trim());
    const pk = k++;
    out.push(<p key={pk}>{renderInline(para.join(" "), `p${pk}`)}</p>);
  }
  return out;
}
