// splatsite/cli/lib/check.mjs — headless verification of a built site (ported from the MMNJ
// lab's spark_check.mjs). Loads the page in headless Chromium under SwiftShader (software
// WebGL — needs no GPU), waits for the splat viewer to report "live", and measures pixel
// coverage of the rendered canvas as a smoke test that something actually painted.
// Exports:
//   chromiumAvailable() -> boolean
//     Whether Playwright's bundled Chromium executable is installed
//     (`npx playwright install chromium` if not).
//   checkSite(url, { out, liveTimeout = 300000, settle = 6000 })
//     -> Promise<{ url, seconds, live, count, pinsTotal, pinsVisible, mapPlan, renderer,
//                  coverage, errors }>
//     Always closes the browser (try/finally), even when the page isn't a splatsite build at
//     all: DOM reads are null-safe, so a page with no #stage resolves quickly with
//     `live: false, count: -1` and an errors entry naming the missing #stage, instead of
//     hanging or throwing.
//   main(argv) -> Promise<number>
//     CLI entry point for `splatsite check <site-or-url> [--out shot.png]`. Serves `site` if
//     it is a local path (a bare URL is checked directly) — refuses up front (exit 2) when a
//     local target is missing/not a directory or has no index.html. Console errors/warnings
//     and cross-origin request failures (e.g. a font CDN, when offline) are reported in the
//     output but do not fail the run; only a page error, a failed same-origin request, a
//     missing #stage, or the stage never going live do that — along with rendering no splats
//     or coverage below 0.2.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";
import { parseArgs, fail } from "./cli-util.mjs";

export function chromiumAvailable() {
  try { return fs.existsSync(chromium.executablePath()); } catch { return false; }
}

export async function checkSite(url, { out = "splatsite-check.png", liveTimeout = 300000, settle = 6000 } = {}) {
  const t0 = Date.now();
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); const errors = [];
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) => {
      let sameOrigin = true;
      try { sameOrigin = new URL(r.url(), url).origin === new URL(url).origin; } catch {}
      // Cross-origin requests (e.g. the Google Fonts CDN) are reported but don't fail the
      // check -- an offline network shouldn't turn a working site into a failing one.
      errors.push(sameOrigin ? `requestfailed: ${r.url()} ${r.failure()?.errorText}` : `requestfailed (cross-origin, ignored): ${r.url()} ${r.failure()?.errorText}`);
    });
    await page.goto(url, { waitUntil: "load", timeout: 120000 });
    const hasStage = (await page.$("#stage")) !== null;
    if (!hasStage) errors.push("no #stage on the page — is this a splatsite build?");
    else { try { await page.waitForSelector("#stage.is-live", { timeout: liveTimeout }); } catch { errors.push("stage never became live"); } }
    const info = await page.evaluate(() => { const stageEl = document.getElementById("stage"); const W = window.MMNJ_WALK, s = W && W.splat(); const pins = [...document.querySelectorAll(".pin")]; const mapPinsEl = document.getElementById("map-pins");
      return { live: !!stageEl && stageEl.classList.contains("is-live"), count: s ? s.state.count : -1, pinsTotal: pins.length, pinsVisible: pins.filter((p) => !p.hidden).length,
        mapPlan: !!mapPinsEl && !mapPinsEl.hidden, renderer: window.VenueSplat ? window.VenueSplat.probe().renderer : "(VenueSplat missing)" }; });
    await page.waitForTimeout(settle);
    info.coverage = await page.evaluate(async () => { const s = window.MMNJ_WALK && window.MMNJ_WALK.splat(); if (!s) return -1; const img = new Image(); img.src = s.snapshot("image/png"); await img.decode();
      const c = document.createElement("canvas"); c.width = 160; c.height = 100; const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, 160, 100); const d = ctx.getImageData(0, 0, 160, 100).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return Math.round(n / 16000 * 1000) / 1000; });
    await page.screenshot({ path: out, timeout: 120000 }).catch((e) => errors.push(`screenshot: ${e.message.split("\n")[0]}`));
    return { url, seconds: Math.round((Date.now() - t0) / 1000), ...info, errors };
  } finally {
    await browser.close();
  }
}

export async function main(argv) {
  const a = parseArgs(argv); const target = a._[0] || "site"; const out = a.out || "splatsite-check.png";
  if (!chromiumAvailable()) throw fail("Chromium for Playwright is not installed — run 'npx playwright install chromium'", 2);
  const isUrl = /^https?:/.test(target);
  if (!isUrl) {
    const abs = path.resolve(target);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw fail(`${target} is not a directory — build a site first with 'splatsite build <scene> --photos DIR --out ${target}'`, 2);
    if (!fs.existsSync(path.join(abs, "index.html"))) throw fail(`${abs}/index.html not found — is this a folder written by 'splatsite build'?`, 2);
  }
  const srv = isUrl ? null : await startServer(target, 0);
  try { const r = await checkSite(srv ? srv.url : target, { out }); const bad = r.errors.filter((e) => /pageerror|requestfailed:|never became|no #stage/.test(e));
    console.log(JSON.stringify(r, null, 1)); console.log(r.errors.length ? "console:\n  " + r.errors.slice(0, 12).join("\n  ") : "console: clean");
    return r.live && r.count > 0 && r.coverage >= 0.2 && bad.length === 0 ? 0 : 1; }
  finally { if (srv) await srv.close(); }
}
