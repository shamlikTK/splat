import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildManual } from "../site/build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the manual carries every source document as a section", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "splat-manual-"));
  const r = buildManual({ root: ROOT, out });
  const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
  for (const s of ["the-skill", "the-pipeline", "the-stage", "the-pattern", "page-recipes", "the-manifest"]) {
    assert.ok(r.sections.includes(s), `missing section ${s}`);
    assert.ok(html.includes(`id="${s}"`), `no anchor for ${s}`);
  }
  fs.rmSync(out, { recursive: true, force: true });
});

test("every table-of-contents link points at an anchor that exists", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "splat-manual-"));
  buildManual({ root: ROOT, out });
  const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
  const links = [...html.matchAll(/<a href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.length > 5, "the table of contents is suspiciously short");
  for (const id of links) assert.ok(html.includes(`id="${id}"`), `dead link: #${id}`);
  fs.rmSync(out, { recursive: true, force: true });
});

test("markdown is escaped, not injected", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "splat-manual-"));
  buildManual({ root: ROOT, out });
  const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
  // the skill's own docs contain <video> and <svg> examples in code fences
  assert.equal(/<script(?![^>]*type="application\/json")/.test(html.split("</head>")[1] || ""), false,
    "a source document injected a script tag into the body");
  fs.rmSync(out, { recursive: true, force: true });
});

test("a missing source document fails loudly", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "splat-manual-"));
  const root = path.join(out, "nothing");
  const expectedPath = path.join(root, "plugins/splat-site/skills/splat-site/SKILL.md");
  let threw;
  try {
    buildManual({ root, out });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, "expected buildManual to throw");
  assert.ok(threw.message.includes(expectedPath), `error should name the specific missing path (${expectedPath}), got: ${threw.message}`);
  assert.deepEqual(fs.readdirSync(out), [], "a failed build must not write a partial page");
  fs.rmSync(out, { recursive: true, force: true });
});
