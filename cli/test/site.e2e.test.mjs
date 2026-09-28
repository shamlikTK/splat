// splatsite/cli/test/site.e2e.test.mjs — end-to-end: build a fixture scene, serve it, and
// verify the page goes live in a headless (SwiftShader) browser via checkSite. Skips cleanly
// when Playwright's Chromium is not installed (run `npx playwright install chromium`).
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { makeScene } from "./fixtures/make-scene.mjs"; import { buildSite } from "../lib/build.mjs"; import { startServer } from "../lib/serve.mjs"; import { checkSite, chromiumAvailable } from "../lib/check.mjs";

test("a built site goes live in a headless browser", { skip: !chromiumAvailable() && "playwright chromium not installed" }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-")); await makeScene(path.join(d, "scene"));
  await buildSite({ scene: path.join(d, "scene"), photos: path.join(d, "scene", "pics"), out: path.join(d, "site") });
  const srv = await startServer(path.join(d, "site"), 0);
  try { const r = await checkSite(srv.url, { out: path.join(d, "shot.png"), liveTimeout: 120000, settle: 3000 }); assert.ok(r.live && r.count > 0, JSON.stringify(r)); assert.equal(r.pinsTotal, 1);
    // Same-origin failures (and page errors) fail the check; a cross-origin failure (e.g. the
    // Google Fonts CDN, when this machine is offline) is reported but must not count as bad.
    assert.deepEqual(r.errors.filter((e) => /pageerror|requestfailed:/.test(e)), []); }
  finally { await srv.close(); }
});

test("a failed cross-origin request (e.g. a font CDN) is reported but doesn't fail the check", { skip: !chromiumAvailable() && "playwright chromium not installed" }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-crossorigin-")); fs.mkdirSync(d, { recursive: true });
  // ".invalid" is reserved by RFC 2606 to never resolve -- this fails deterministically and
  // offline, without depending on whether this machine actually has network access.
  fs.writeFileSync(path.join(d, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="http://fonts.example.invalid/font.css"></head><body><h1>not a splatsite build</h1></body></html>');
  const srv = await startServer(d, 0);
  try {
    const r = await checkSite(srv.url, { out: path.join(d, "shot.png"), liveTimeout: 2000, settle: 500 });
    assert.ok(r.errors.some((e) => /requestfailed \(cross-origin, ignored\).*fonts\.example\.invalid/.test(e)), JSON.stringify(r.errors));
    // main()'s bad-filter regex (duplicated here) must not treat the cross-origin failure as bad.
    const bad = r.errors.filter((e) => /pageerror|requestfailed:|never became|no #stage/.test(e));
    assert.ok(!bad.some((e) => /fonts\.example\.invalid/.test(e)), JSON.stringify(bad));
  } finally { await srv.close(); }
});

test("checkSite against a plain page with no #stage resolves (does not hang) and reports it live:false", { skip: !chromiumAvailable() && "playwright chromium not installed", timeout: 60000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-nostage-")); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "index.html"), "<!doctype html><html><body><h1>not a splatsite build</h1></body></html>");
  const srv = await startServer(d, 0);
  try {
    const r = await checkSite(srv.url, { out: path.join(d, "shot.png"), liveTimeout: 2000, settle: 500 });
    assert.equal(r.live, false);
    assert.equal(r.count, -1);
    assert.ok(r.errors.some((e) => /#stage/.test(e)), JSON.stringify(r.errors));
  } finally { await srv.close(); }
});
