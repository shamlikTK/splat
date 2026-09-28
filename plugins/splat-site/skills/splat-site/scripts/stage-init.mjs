#!/usr/bin/env node
// splat-site/scripts/stage-init.mjs — install the splat stage runtime into a scroll-craft build
// and write the scene description its acts fly through.
//
//   node stage-init.mjs <scene-dir> --out <build-dir> [--stops 5]
//
// Copies (never deletes): vendor/three + Spark and splat.js from the splatsite CLI template,
// splat-stage.js/.css from this skill, the capture tiers and posters into <build>/assets, and
// writes <build>/scene.json. Safe to rerun after a reconvert — it overwrites those files only.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadScene, derivePoses, sanity, printReport } from "./scene-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i === -1 ? dflt : argv[i + 1]; };
const dir = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--out" && argv[argv.indexOf(a) - 1] !== "--stops");
const out = flag("out", null);
if (!dir || !out) { console.error("usage: node stage-init.mjs <scene-dir> --out <build-dir> [--stops 5]"); process.exit(2); }

const scene = await loadScene(dir);
const rows = sanity(scene);
if (printReport(rows)) { console.error("\nrefusing to install the stage: fix the errors above first."); process.exit(2); }

const poses = derivePoses(scene, { stops: Number(flag("stops", 5)) });
fs.mkdirSync(path.join(out, "assets"), { recursive: true });

// runtime: the Spark adapter and its vendored three/Spark come from the CLI template, so the
// renderer a page uses is the same one the CLI's own template and `splatsite check` exercise.
const tpl = path.join(scene.cli, "template");
fs.cpSync(path.join(tpl, "vendor"), path.join(out, "vendor"), { recursive: true });
fs.copyFileSync(path.join(tpl, "splat.js"), path.join(out, "splat.js"));
for (const f of ["splat-stage.js", "splat-stage.css"]) fs.copyFileSync(path.join(HERE, "..", "assets", f), path.join(out, f));

const asset = (rel) => {
  if (!rel) return null;
  const src = path.join(scene.dir, rel);
  if (!fs.existsSync(src)) return null;
  const dst = path.posix.join("assets", path.basename(rel));
  fs.copyFileSync(src, path.join(out, dst));
  return dst;
};

const m = scene.m, F = scene.F;
const tier = (key, dflt) => {
  const p = m.config?.[key] || {};
  const file = asset(p.file || m.capture);
  return file ? { file, lod: !!p.lod, maxDpr: p.maxDpr ?? dflt, size: p.size ?? 1 } : null;
};
const tiers = { desktop: tier("desktop", 1.5), mobile: tier("mobile", 1.25), software: tier("software", 1) };
for (const k of Object.keys(tiers)) if (!tiers[k]) tiers[k] = tiers.desktop;

// A poster is not decoration: it is the whole picture under reduced motion, on a machine with
// no WebGL2, and for the seconds before several million splats have streamed in. A scene
// converted without posters still gets one, flat in the capture's own ground colour.
const ground = m.theme?.ground || "#0A0F0C";
const fallback = (name, w, h) => {
  const rel = path.posix.join("assets", name);
  fs.writeFileSync(path.join(out, rel), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${ground}"/></svg>`);
  return rel;
};
const posters = {
  desktop: asset(m.posters?.desktop) || fallback("poster-desktop.svg", 16, 9),
  mobile: asset(m.posters?.mobile) || fallback("poster-mobile.svg", 9, 16),
  alt: m.posters?.alt || "",
};

const sceneJson = {
  title: m.title,
  up: F.up, fwd: F.fwd, right: F.right, origin: F.origin, fwd0: F.fwd0, fwd1: F.fwd1,
  ground: m.ground?.point || F.origin,
  fov: { desktop: m.config?.fov?.desktop ?? 52, mobile: m.config?.fov?.mobile ?? 62 },
  tiers, posters, poses,
};
fs.writeFileSync(path.join(out, "scene.json"), JSON.stringify(sceneJson, null, 1));

const names = Object.keys(poses);
console.log(`stage installed in ${path.resolve(out)}`);
console.log(`  scene.json      ${names.length} poses: ${names.join(", ")}`);
console.log(`  tiers           desktop ${tiers.desktop.file}, mobile ${tiers.mobile.file}, software ${tiers.software.file}`);
console.log(`  runtime         splat-stage.js, splat-stage.css, splat.js, vendor/`);
console.log("");
console.log("Paste into the page head (the import map must come before the module):");
console.log(`
<link rel="stylesheet" href="splat-stage.css">
<script type="importmap">{"imports":{"three":"./vendor/three.module.js","three/addons/":"./vendor/three-addons/","@sparkjsdev/spark":"./vendor/spark.module.js"}}</script>`);
console.log("At the end of the body, in this order (the engine must be mounted or no act publishes progress):");
console.log(`
<script src="scrollcraft.js"></script>
<script>ScrollCraft.mount(document.body);</script>
<script type="module" src="splat-stage.js"></script>`);
console.log("And the stage itself, once, above the copy layer (id=\"stage\" is what 'splatsite check' looks for):");
console.log(`
<div class="ss-stage" id="stage" data-ss-stage="scene.json" data-sc-verify-state="" data-ss-look="5 3">
  <img class="ss-poster" src="${posters.desktop}" alt="${posters.alt || "The capture."}">
  <canvas class="ss-canvas"></canvas>
</div>`);
