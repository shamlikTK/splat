#!/usr/bin/env node
// splat-site/scripts/frame-spots.mjs — turn frames of the capture into manifest spots (or pin
// coordinates for a bespoke page) by reading where each frame's camera actually stood.
//
//   node frame-spots.mjs <scene-dir> [--count 5] [--frames f1,f2] [--photos ./pics] [--write]
//
// Frame filenames are NOT in walk order — the frame extractor drops blurry ones and the phone's
// path is not monotonic — so picking "every third file" scatters pins. This projects each
// frame's camera position onto the scene's own walk axis, sorts by that, and spaces the
// selection along the walk for real.
//
// --photos DIR  copies the chosen frames into DIR, ready for `splatsite build --photos DIR`
// --write       splices the spots into the scene's manifest.json (keeps a .bak)
// Without --write it prints the spots array to paste, which is the safer default.

import fs from "node:fs";
import path from "node:path";
import { loadScene } from "./scene-lib.mjs";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes(`--${n}`);
const dir = argv.find((a, i) => !a.startsWith("--") && !/^--(count|frames|photos)$/.test(argv[i - 1] || ""));
if (!dir) { console.error("usage: node frame-spots.mjs <scene-dir> [--count 5] [--frames a.jpg,b.jpg] [--photos ./pics] [--write]"); process.exit(2); }

const scene = await loadScene(dir);
const { m, F, ground } = scene;
const camFile = path.join(scene.dir, "cameras.json");
if (!fs.existsSync(camFile)) { console.error(`${camFile} not found — this needs the camera poses 'splatsite convert' writes`); process.exit(2); }
const cams = JSON.parse(fs.readFileSync(camFile, "utf8")).cameras || [];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const round = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;

const up = norm(F.up), fwd = norm(F.fwd);
const right = F.right ? norm(F.right) : norm([up[1] * fwd[2] - up[2] * fwd[1], up[2] * fwd[0] - up[0] * fwd[2], up[0] * fwd[1] - up[1] * fwd[0]]);
const eyeH = m.config?.eyeHeight ?? 0.15;
const standBack = m.config?.standBack ?? eyeH * 1.25;
const span = (F.fwd1 ?? 1) - (F.fwd0 ?? 0) || 1;

// A photo's pin marks what was photographed, not where the photographer stood: the walker
// stops `standBack` short of a pin and looks at it, so placing the pin at the camera position
// would stand the camera behind where the photo was actually taken.
const rows = cams.map((c) => {
  const M = c.c2w;
  const pos = [M[0][3], M[1][3], M[2][3]];
  const look = norm([M[0][2], M[1][2], M[2][2]]);
  const flat = norm(sub(look, mul(up, dot(look, up))));
  const p = add(pos, mul(flat, standBack));
  const d = sub(p, F.origin);
  return {
    file: c.name,
    t: round((dot(d, fwd) - (F.fwd0 ?? 0)) / span),
    a: round(dot(d, right)),
    h: round(eyeH),
    raw: round(dot(d, fwd)),
  };
}).sort((x, y) => x.t - y.t);

let picked;
const named = flag("frames", null);
if (named) {
  const want = named.split(",").map((s) => s.trim());
  picked = want.map((w) => rows.find((r) => r.file === w || r.file.startsWith(w))).filter(Boolean);
  const missing = want.filter((w) => !rows.some((r) => r.file === w || r.file.startsWith(w)));
  if (missing.length) console.error(`WARN  no camera for ${missing.join(", ")} — a frame the extractor kept but the reconstruction did not register?`);
} else {
  const n = Math.max(1, Math.min(Number(flag("count", 5)), rows.length));
  // spaced along the walk, avoiding the very ends where the reconstruction is thinnest
  picked = Array.from({ length: n }, (_, i) => rows[Math.round(((rows.length - 1) * (i + 0.5)) / n)]);
}

const spots = picked.map((r, i) => ({
  label: `Spot ${i + 1}`,
  pin: { t: r.t, a: r.a, h: r.h },
  photos: [{ file: r.file, title: "Describe what this photo shows", alt: "Describe the photo for a reader who cannot see it." }],
}));

const photos = flag("photos", null);
if (photos) {
  fs.mkdirSync(photos, { recursive: true });
  for (const r of picked) {
    const src = path.join(scene.dir, "stages", "images", r.file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(photos, r.file));
    else console.error(`WARN  ${src} not found — the frames may have been cleaned up`);
  }
  console.error(`copied ${picked.length} frames into ${photos}`);
}

if (has("write")) {
  const file = path.join(scene.dir, "manifest.json");
  fs.copyFileSync(file, file + ".bak");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  json.spots = spots;
  fs.writeFileSync(file, JSON.stringify(json, null, 1));
  console.error(`wrote ${spots.length} spots into ${file} (previous kept as manifest.json.bak)`);
  console.error("Edit each label, title and alt before building: placeholder captions are not a page.");
}

console.log(JSON.stringify(spots, null, 1));
console.error("");
console.error(`walk order of the chosen frames (t along the path): ${picked.map((r) => `${r.file} t=${r.t}`).join(", ")}`);
console.error("Frame numbers do not follow the walk — the order above is the real one.");
