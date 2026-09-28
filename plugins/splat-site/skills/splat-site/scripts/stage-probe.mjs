#!/usr/bin/env node
// splat-site/scripts/stage-probe.mjs — prove the camera actually moves as the page scrolls.
//
//   node stage-probe.mjs <site-dir-or-url> [--positions 10] [--settle 700] [--shots DIR]
//
// The scroll-craft harness answers this as part of a much larger screenshot walk, which on a
// software renderer is slow and can lose the tab mid-run. This asks only the 3D question, in
// seconds: at each scroll position it reads the camera signature the stage publishes in
// `data-sc-verify-state` and reports where it stopped changing. A run of identical signatures
// across an act that is not an authored hold is dead scroll — the visitor pushes the wheel and
// the world does not answer.
//
// With --shots it also screenshots every position and tiles a contact sheet, which is the only
// visual evidence available for the waypoint-walk grammar: scroll-craft's own harness samples
// positions *inside acts*, and that grammar has none, so it photographs the first screen and
// stops.
//
// Exits 1 when the stage never went live, or when a third or more of the sampled steps are
// still, which is the point where a page reads as broken rather than paced.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolveCli } from "./scene-lib.mjs";
import fsp from "node:fs/promises";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : Number(argv[i + 1]); };
const target = argv.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
if (!target) { console.error("usage: node stage-probe.mjs <site-dir-or-url> [--positions 10] [--settle 700]"); process.exit(2); }

const N = Math.max(3, flag("positions", 10));
const SETTLE = flag("settle", 700);
const SHOTS = (() => { const i = argv.indexOf("--shots"); return i === -1 ? null : argv[i + 1]; })();
const cli = resolveCli();
const require = createRequire(path.join(cli, "package.json"));
const { chromium } = require("playwright");

const isUrl = /^https?:/.test(target);
let server = null, url = target;
if (!isUrl) {
  const abs = path.resolve(target);
  if (!fs.existsSync(path.join(abs, "index.html"))) { console.error(`${abs}/index.html not found — pass a built site or a URL`); process.exit(2); }
  const { startServer } = await import(pathToFileURL(path.join(cli, "lib", "serve.mjs")).href);
  server = await startServer(abs, 0);
  url = server.url;
}
// ?ss-tier=software keeps the fetched capture small: this probe cares about camera motion, not
// about how many splats the machine can hold.
// ss-still pauses the renderer once the camera settles: without it a screenshot of a live splat
// canvas runs past any reasonable timeout.
url += (url.includes("?") ? "&" : "?") + "ss-tier=software" + (SHOTS ? "&ss-still=1" : "");

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  const live = await page.waitForSelector("#stage.is-live", { timeout: 300000 }).then(() => true).catch(() => false);
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const rows = [];
  for (let i = 0; i < N; i++) {
    const y = Math.round((total * i) / (N - 1));
    await page.evaluate((to) => scrollTo(0, to), y);
    await page.waitForTimeout(SETTLE);
    if (SHOTS) {
      await fsp.mkdir(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, String(i).padStart(2, "0") + ".png"), timeout: 150000 });
    }
    rows.push(await page.evaluate(() => {
      const s = document.querySelector("[data-sc-verify-state]");
      const act = [...document.querySelectorAll("[data-ss-move]")].find((el) => { const r = el.getBoundingClientRect(); return r.top <= innerHeight / 2 && r.bottom >= innerHeight / 2; });
      return { sig: s ? s.getAttribute("data-sc-verify-state") : "(no stage)", move: act ? act.getAttribute("data-ss-move") : "-", hold: act ? act.getAttribute("data-sc-verify-hold") === "true" : false, y: scrollY };
    }));
  }
  let still = 0;
  console.log(`live: ${live}   positions: ${N}   scrollable: ${total}px`);
  rows.forEach((r, i) => {
    const same = i > 0 && r.sig === rows[i - 1].sig;
    if (same && !r.hold) still++;
    console.log(`  ${String(r.y).padStart(6)}px  ${(r.move || "-").padEnd(14)} ${same ? (r.hold ? "held (authored)" : "STILL") : "moved"}  ${r.sig}`);
  });
  if (errors.length) console.log("page errors:\n  " + errors.join("\n  "));
  const dead = still / (N - 1);
  console.log(`\nstill steps: ${still} of ${N - 1} (${Math.round(dead * 100)}%)`);
  if (!live) { console.log("FAIL the stage never went live"); code = 1; }
  else if (dead >= 1 / 3) { console.log("FAIL too much of the scroll leaves the camera where it was — either give those acts a move, or mark authored holds with data-sc-verify-hold=\"true\""); code = 1; }
  else console.log("PASS the world answers the scroll");
  if (errors.length) code = 1;
  if (SHOTS) await sheet(SHOTS, N);
} finally {
  await browser.close();
  if (server) await server.close();
}
// A contact sheet is the thing you actually read: one glance says whether the walk holds
// together, which no pass/fail number can.
async function sheet(dir, n) {
  const require2 = createRequire(path.join(cli, "package.json"));
  let sharp;
  try { sharp = require2("sharp"); } catch { console.log(`shots in ${dir} (no sheet: sharp not resolvable)`); return; }
  const cols = Math.min(4, n), tile = 480;
  const files = [];
  for (let i = 0; i < n; i++) { const f = path.join(dir, String(i).padStart(2, "0") + ".png"); if (fs.existsSync(f)) files.push(f); }
  if (!files.length) return;
  const rows = Math.ceil(files.length / cols);
  const tiles = await Promise.all(files.map(async (f, i) => ({
    input: await sharp(f).resize(tile, Math.round(tile * 0.625), { fit: "cover" }).toBuffer(),
    left: (i % cols) * tile, top: Math.floor(i / cols) * Math.round(tile * 0.625),
  })));
  const out = path.join(dir, "sheet.png");
  await sharp({ create: { width: cols * tile, height: rows * Math.round(tile * 0.625), channels: 3, background: "#000" } })
    .composite(tiles).png().toFile(out);
  console.log(`contact sheet: ${out}`);
}

process.exit(code);
