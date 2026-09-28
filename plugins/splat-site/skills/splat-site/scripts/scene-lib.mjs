// splat-site/scripts/scene-lib.mjs — shared helpers for the scene scripts.
// Exports:
//   resolveCli() -> absolute path to the splatsite CLI package root (holds bin/, lib/, template/)
//   loadScene(dir) -> { dir, m, F, ground, bounds }           a folder written by `splatsite convert`
//   derivePoses(scene, { stops }) -> { name: { eye, target } } named camera poses for a page
//   sanity(scene) -> [{ level: "error"|"warn"|"note", message }]
// Everything that interprets a manifest (frame maths, {t,a,h} resolution) is imported from the
// CLI itself rather than reimplemented here, so the two can never drift apart.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const isCli = (p) => p && fs.existsSync(path.join(p, "lib", "manifest.mjs")) && fs.existsSync(path.join(p, "template", "splat.js"));

export function resolveCli() {
  const tried = [];
  const take = (p) => { if (!p) return null; const abs = path.resolve(p); tried.push(abs); return isCli(abs) ? abs : null; };

  let hit = take(process.env.SPLATSITE_CLI);
  if (hit) return hit;

  // a `splatsite` on PATH points at bin/splatsite.mjs inside the package
  try {
    const bin = execFileSync("sh", ["-c", "command -v splatsite"], { encoding: "utf8" }).trim();
    if (bin) hit = take(path.dirname(path.dirname(fs.realpathSync(bin))));
    if (hit) return hit;
  } catch { /* not on PATH */ }

  // walk up from the cwd: a checkout of the splatsite repo anywhere above us
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    hit = take(path.join(dir, "splatsite", "cli")) || take(path.join(dir, "cli"));
    if (hit) return hit;
    if (dir === path.dirname(dir)) break;
  }

  hit = take(path.join(os.homedir(), "random", "3dspacial", "splatsite", "cli"));
  if (hit) return hit;

  throw new Error(`cannot find the splatsite CLI (a folder with lib/manifest.mjs and template/splat.js).\nTried:\n  ${tried.join("\n  ")}\nSet SPLATSITE_CLI=/path/to/splatsite/cli and rerun.`);
}

export async function loadScene(dir) {
  const cli = resolveCli();
  const { loadManifest, frameOf, resolve } = await import(pathToFileURL(path.join(cli, "lib", "manifest.mjs")).href);
  const file = path.join(dir, "manifest.json");
  if (!fs.existsSync(file)) {
    // A scene can have every capture file and still be missing its manifest: older images wrote
    // it to the container's own /work instead of the mounted output, and the stage marker still
    // says it finished. The fix costs seconds, because every heavy stage is already done.
    const hasStages = fs.existsSync(path.join(dir, "stages"));
    throw new Error(`${file} not found.` + (hasStages
      ? `\n${dir} has finished stages but no manifest. Delete ${path.join(dir, "stages", "manifest.done")} and rerun the same 'splatsite convert' command with --out ${dir}: every other stage is already done, so it only redoes the manifest.`
      : `\nIs ${dir} a folder written by 'splatsite convert'?`));
  }
  const m = loadManifest(file);
  const F = frameOf(m);
  const ground = m.ground?.point || F.origin;
  const boundsFile = path.join(dir, "bounds.json");
  const bounds = fs.existsSync(boundsFile) ? JSON.parse(fs.readFileSync(boundsFile, "utf8")) : null;
  return { dir: path.resolve(dir), cli, m, F, ground, bounds, resolve: (p) => resolve(p, F, ground) };
}

// The named poses a page's acts fly between. Three come from the capture itself (the walk's
// ends and its overview); the rest are evenly spaced standing positions along the walk, which
// is what a scroll score actually needs — "a bit further in" is a beat, raw coordinates are not.
export function derivePoses(scene, { stops = 5 } = {}) {
  const { m, F, resolve } = scene;
  const eyeH = m.config?.eyeHeight ?? 0.15;
  // Look along `fwd`, which the sanity check guarantees points into the capture — not along
  // increasing `t`. Footage shot walking backwards gives a path whose distance range runs
  // negative, so "further along the walk" is away from everything worth seeing.
  const fwdU = unit(F.fwd);
  const span = Math.abs((F.fwd1 ?? 1) - (F.fwd0 ?? 0));
  const ahead = Math.max(0.3 * span, 0.25 * (scene.bounds?.radius || span || 1));
  const out = {};
  for (const key of ["gate", "rise", "close"]) {
    const p = m.poses?.[key];
    if (p) out[key] = { eye: resolve(p.eye), target: resolve(p.target) };
  }
  const n = Math.max(2, stops);
  for (let i = 0; i < n; i++) {
    const t = 0.05 + (0.9 * i) / (n - 1);
    const eye = resolve({ t, a: 0, h: eyeH });
    out[`w${i + 1}`] = { eye, target: [eye[0] + fwdU[0] * ahead, eye[1] + fwdU[1] * ahead, eye[2] + fwdU[2] * ahead] };
  }
  if (scene.bounds?.center) {
    out.wide = out.rise ? { eye: out.rise.eye, target: scene.bounds.center } : null;
    if (!out.wide) delete out.wide;
  }
  return out;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function sanity(scene) {
  const out = [];
  const { dir, m, F, bounds } = scene;
  if (fs.existsSync(path.join(dir, "sog-pending"))) {
    out.push({ level: "error", message: `${dir} still has a 'sog-pending' marker: the capture is PLY tiers, not .sog. Run 'splatsite finish ${dir}' on a machine with a GPU first.` });
  }
  const tiers = [m.capture, m.config?.mobile?.file, m.config?.software?.file].filter(Boolean);
  for (const t of new Set(tiers)) {
    const f = path.join(dir, t);
    if (!fs.existsSync(f)) out.push({ level: "error", message: `capture tier ${t} is missing from ${dir}` });
    else out.push({ level: "note", message: `${t}: ${(fs.statSync(f).size / 1e6).toFixed(1)} MB` });
  }
  // The trap that produces a page reporting itself live with splats loaded and rendering
  // nothing: the walking direction was derived from where the phone moved, not where it looked,
  // so every pose faces away from the geometry.
  if (bounds?.center) {
    const toward = dot(sub(bounds.center, F.origin), F.fwd);
    if (toward <= 0) {
      out.push({ level: "error", message: `frame.fwd points AWAY from the capture (dot = ${toward.toFixed(3)}). Every derived pose will look at empty space and the page will render blank. Fix: negate frame.fwd and frame.right in ${path.join(dir, "manifest.json")}, then rerun this script.` });
    } else {
      out.push({ level: "note", message: `frame.fwd points into the capture (dot = ${toward.toFixed(3)})` });
    }
    const walk = Math.abs((F.fwd1 ?? 1) - (F.fwd0 ?? 0));
    if ((F.fwd1 ?? 1) < (F.fwd0 ?? 0)) {
      out.push({ level: "note", message: "the walk's t runs against the viewing direction (the capture was shot walking backwards): t=0 is the end of the path nearest the subject, so a page that approaches it runs its poses from w5 down to w1." });
    }
    if (bounds.radius && walk < bounds.radius * 0.25) {
      out.push({ level: "warn", message: `the walk is short relative to the capture (path ${walk.toFixed(2)} vs radius ${bounds.radius.toFixed(2)}): flying along it will barely move. Consider poses built around the capture centre, or an orbit act, instead of a long walk.` });
    }
  } else {
    out.push({ level: "warn", message: "no bounds.json in the scene: cannot check that the walk faces the capture" });
  }
  if (bounds?.count) out.push({ level: "note", message: `${(bounds.count / 1e6).toFixed(2)}M splats` });
  return out;
}

export function printReport(rows) {
  const mark = { error: "ERROR", warn: "WARN ", note: "     " };
  for (const r of rows) console.log(`${mark[r.level]} ${r.message}`);
  return rows.some((r) => r.level === "error");
}
