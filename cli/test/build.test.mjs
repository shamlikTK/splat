// splatsite/cli/test/build.test.mjs — tests for lib/build.mjs (buildSite assembling a static site).
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { makeScene } from "./fixtures/make-scene.mjs"; import { buildSite } from "../lib/build.mjs";

test("build assembles a complete static site from a scene folder", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "site-")); await makeScene(path.join(d, "scene"));
  const r = await buildSite({ scene: path.join(d, "scene"), photos: path.join(d, "scene", "pics"), out: path.join(d, "site") });
  for (const f of ["index.html", "site.css", "theme.css", "scrollcraft.css", "scrollcraft.js", "splat.js", "walk.js", "viewer.js", "vendor/spark.module.js", "assets/capture.sog", "assets/capture-lite.sog", "photos/p1.jpg", "photos/p1-thumb.jpg"])
    assert.ok(fs.existsSync(path.join(d, "site", f)), `missing ${f}`);
  const html = fs.readFileSync(path.join(d, "site", "index.html"), "utf8");
  assert.match(html, /window\.MMNJ_PAGE = \{/); assert.match(html, /"file":"assets\/capture.sog"/); assert.match(html, /data-pin="/); assert.doesNotMatch(html, /\{\{\w+\}\}/);
  assert.match(html, /assets\/capture-mobile\.sog/); assert.match(html, /assets\/capture-lite\.sog/);
  assert.match(fs.readFileSync(path.join(d, "site", "theme.css"), "utf8"), /--sc-accent:\s*#00AAFF/);
  // theme-color must follow the manifest's theme.ground (make-scene.mjs's fixture sets #101010), not a hardcoded color.
  assert.match(html, /<meta name="theme-color" content="#101010">/);
  assert.equal(r.spots, 1);
});

test("build refuses an --out that would delete the scene folder", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "site-")); const scene = path.join(d, "scene"); await makeScene(scene);
  await assert.rejects(buildSite({ scene, photos: path.join(scene, "pics"), out: scene }), (e) => e.code === 2);
  assert.ok(fs.existsSync(path.join(scene, "manifest.json")), "scene must survive the refused build");
});

test("config JSON escapes < so a manifest value can't close the script tag early", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "site-")); const scene = path.join(d, "scene"); await makeScene(scene);
  const mf = JSON.parse(fs.readFileSync(path.join(scene, "manifest.json"), "utf8"));
  mf.config.note = "</script><script>window.pwned=1</script>";
  fs.writeFileSync(path.join(scene, "manifest.json"), JSON.stringify(mf));
  await buildSite({ scene, photos: path.join(scene, "pics"), out: path.join(d, "site") });
  const html = fs.readFileSync(path.join(d, "site", "index.html"), "utf8");
  assert.doesNotMatch(html, /<\/script><script>window\.pwned/);
  assert.match(html, /\\u003c\/script>\\u003cscript>window\.pwned/);
});

test("build copies each reused capture file only once", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "site-")); const scene = path.join(d, "scene"); await makeScene(scene);
  // the fixture manifest reuses capture.sog for m.capture, config.desktop.file, config.full and
  // config.viewer.file (4 references to the same source file) -- it must be copied only once.
  const original = fs.copyFileSync; const calls = [];
  fs.copyFileSync = (src, dst, ...rest) => { calls.push(src); return original(src, dst, ...rest); };
  try {
    await buildSite({ scene, photos: path.join(scene, "pics"), out: path.join(d, "site") });
  } finally {
    fs.copyFileSync = original;
  }
  const captureCopies = calls.filter((s) => s.endsWith("capture.sog"));
  assert.equal(captureCopies.length, 1, `capture.sog should be copied once, was copied ${captureCopies.length} times`);
});

test("build refuses an --out equal to the photos directory, and the photos survive", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "site-")); const scene = path.join(d, "scene"); await makeScene(scene);
  const photos = path.join(scene, "pics");
  await assert.rejects(buildSite({ scene, photos, out: photos }), (e) => e.code === 2);
  assert.ok(fs.existsSync(path.join(photos, "p1.jpg")), "photos must survive the refused build");
});

test("manifest text is escaped before it enters the template", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "site-")); const scene = path.join(d, "scene"); await makeScene(scene);
  const mf = JSON.parse(fs.readFileSync(path.join(scene, "manifest.json"), "utf8"));
  mf.title = "<b>&\"";
  fs.writeFileSync(path.join(scene, "manifest.json"), JSON.stringify(mf));
  await buildSite({ scene, photos: path.join(scene, "pics"), out: path.join(d, "site") });
  const html = fs.readFileSync(path.join(d, "site", "index.html"), "utf8");
  assert.match(html, /&lt;b&gt;&amp;&quot;/);
  assert.doesNotMatch(html, /<title><b>/);
});
