#!/usr/bin/env node
// splat-site/scripts/scene-plan.mjs — read a converted scene and report what a page can be
// built from it: the capture's size and tiers, whether its frame faces the geometry, and the
// named camera poses acts can fly between.
//
//   node scene-plan.mjs <scene-dir> [--stops 5] [--json]
//
// Exits 2 when something would produce a blank or broken page, so this is worth running before
// any page planning rather than after the first screenshot comes back empty.

import { loadScene, derivePoses, sanity, printReport } from "./scene-lib.mjs";

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith("--"));
const flag = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i === -1 ? dflt : argv[i + 1]; };
if (!dir) { console.error("usage: node scene-plan.mjs <scene-dir> [--stops 5] [--json]"); process.exit(2); }

const scene = await loadScene(dir);
const poses = derivePoses(scene, { stops: Number(flag("stops", 5)) });
const rows = sanity(scene);

if (argv.includes("--json")) {
  console.log(JSON.stringify({ poses, findings: rows }, null, 1));
  process.exit(rows.some((r) => r.level === "error") ? 2 : 0);
}

console.log(`scene: ${scene.dir}`);
console.log(`title: ${scene.m.title}   spots in manifest: ${scene.m.spots.length}`);
console.log("");
const bad = printReport(rows);
console.log("");
console.log("poses available to acts (data-ss-move):");
for (const [name, p] of Object.entries(poses)) {
  const f = (a) => `[${a.map((n) => n.toFixed(3)).join(", ")}]`;
  console.log(`  ${name.padEnd(6)} eye ${f(p.eye)}  ->  ${f(p.target)}`);
}
console.log("");
console.log("gate/rise/close come from the capture (walk start, overview, walk end).");
console.log("w1..wN are standing positions spaced along the walk, looking forward down it.");
console.log("Fly between them with data-ss-move=\"gate>w3\"; hold at one with data-ss-move=\"w3\".");
process.exit(bad ? 2 : 0);
