#!/usr/bin/env node
// site/build.mjs — generate the manual page from the skill's own markdown.
// Exports: buildManual({ root, out }) -> { sections, bytes }
//
// The skill's files are the authority. Hand-copied documentation drifts within a week, so the
// published manual is generated from them and regenerated whenever they change.
import fs from "node:fs";
import path from "node:path";

const SOURCES = [
  { id: "the-skill", title: "The skill", file: "plugins/splat-site/skills/splat-site/SKILL.md" },
  { id: "the-pipeline", title: "The pipeline", file: "plugins/splat-site/skills/splat-site/references/pipeline.md" },
  { id: "the-stage", title: "The stage", file: "plugins/splat-site/skills/splat-site/references/stage-api.md" },
  { id: "the-pattern", title: "The waypoint walk", file: "plugins/splat-site/skills/splat-site/references/house-pattern.md" },
  { id: "page-recipes", title: "Designing the page", file: "plugins/splat-site/skills/splat-site/references/page-recipes.md" },
  { id: "the-manifest", title: "The manifest", file: "plugins/splat-site/cli/docs/manifest.md" },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A deliberately small markdown renderer: headings, fenced code, tables, ordered and unordered
// lists, blockquotes, paragraphs, inline code, bold and links. The sources are ours, so this
// does not need to survive hostile input, but everything is escaped anyway.
//
// `isBlockStart` decides where a paragraph ends. It has to be precise: these docs are full of
// paragraphs that *begin* with an inline code span (`` `splatsite convert` does... ``), which
// starts with a bare backtick, and a blockquote note whose lines start with `>`. A naive
// "stop the paragraph at any line starting with one of #>|`-*" check treats those as the start
// of a new block, matches on the very first line, consumes nothing, and never advances `i` —
// an infinite loop. So block-start detection reuses the same anchored patterns the block
// handlers themselves use (heading needs "# ", not just "#"; fence needs "```"; etc.), not a
// loose leading-character guess.
function render(md) {
  const out = [];
  const lines = md.split("\n");
  let i = 0;
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => `<a href="${esc(href)}">${text}</a>`);

  const isHeading = (l) => /^(#{1,4})\s+/.test(l);
  const isTableRow = (l) => /^\s*\|/.test(l);
  const isBullet = (l) => /^\s*[-*]\s+/.test(l);
  const isOrdered = (l) => /^\s*\d+\.\s+/.test(l);
  const isQuote = (l) => /^\s*>/.test(l);
  const isFence = (l) => l.startsWith("```");
  const isIndented = (l) => /^\s/.test(l);
  const isBlockStart = (l) => !l.trim() || isFence(l) || isHeading(l) || isTableRow(l) || isBullet(l) || isOrdered(l) || isQuote(l);
  // A list item's own text wraps onto indented continuation lines with no marker of their own
  // (standard markdown "lazy continuation") — fold those back into the item instead of letting
  // them start a stray one-line list or paragraph.
  const collectItem = (strip) => {
    let text = lines[i++].replace(strip, "");
    while (i < lines.length && lines[i].trim() && isIndented(lines[i]) && !isBlockStart(lines[i])) {
      text += " " + lines[i++].trim();
    }
    return text;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (isFence(line)) {
      const body = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { const n = h[1].length + 1; out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (isTableRow(line)) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
        body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>`);
      continue;
    }
    if (isQuote(line)) {
      const body = [];
      while (i < lines.length && isQuote(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote><p>${inline(body.join(" "))}</p></blockquote>`);
      continue;
    }
    if (isBullet(line)) {
      const items = [];
      while (i < lines.length && isBullet(lines[i])) items.push(collectItem(/^\s*[-*]\s+/));
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      continue;
    }
    if (isOrdered(line)) {
      const items = [];
      while (i < lines.length && isOrdered(lines[i])) items.push(collectItem(/^\s*\d+\.\s+/));
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && !isBlockStart(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

// Strip the YAML frontmatter: it is skill metadata, not documentation.
const body = (md) => (md.startsWith("---") ? md.slice(md.indexOf("\n---", 3) + 4) : md);

export function buildManual({ root, out }) {
  fs.mkdirSync(out, { recursive: true });
  const sections = [];
  const parts = [];
  for (const s of SOURCES) {
    const file = path.join(root, s.file);
    if (!fs.existsSync(file)) throw new Error(`manual source missing: ${file} (expected ${s.file} under root ${root})`);
    sections.push(s.id);
    parts.push(`<section id="${s.id}"><h1>${esc(s.title)}</h1>\n${render(body(fs.readFileSync(file, "utf8")))}</section>`);
  }
  const toc = SOURCES.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join("");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>splat-site · the manual</title>
<meta name="description" content="Every command, attribute and failure mode of the splat-site skill.">
<link rel="stylesheet" href="manual.css">
</head>
<body>
<header class="bar"><a href="../">splat-site</a><a href="https://github.com/shamlikt/splat">GitHub</a></header>
<nav class="toc"><p>Contents</p><ul>${toc}</ul></nav>
<main>${parts.join("\n")}</main>
<footer><p>Generated from the skill's own files. Editing the skill updates this page.</p></footer>
</body>
</html>
`;
  const file = path.join(out, "index.html");
  fs.writeFileSync(file, html);
  const css = path.join(path.dirname(new URL(import.meta.url).pathname), "manual/manual.css");
  if (fs.existsSync(css) && path.resolve(out) !== path.resolve(path.dirname(css))) {
    fs.copyFileSync(css, path.join(out, "manual.css"));
  }
  return { sections, bytes: html.length };
}

if (process.argv[1] && (process.argv[1].endsWith("build.mjs") || process.argv[1].endsWith("build-manual.mjs"))) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const r = buildManual({ root, out: path.join(root, "site/manual") });
  console.log(`manual: ${r.sections.length} sections, ${(r.bytes / 1024).toFixed(0)} KB`);
}
