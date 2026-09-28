// scripts/validate-repo.mjs — check the repository is a well-formed marketplace before release.
// Exports: validateRepo(root) -> { ok, problems }
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REQUIRED = [
  ".claude-plugin/marketplace.json",
  "plugins/splat-site/.claude-plugin/plugin.json",
  "plugins/splat-site/skills/splat-site/SKILL.md",
  "plugins/splat-site/cli/bin/splatsite.mjs",
  "plugins/splat-site/cli/package.json",
  "docker/Dockerfile",
  "README.md",
  "LICENSE",
];

// A distribution repo must never carry footage or reconstructions: they are large, they are
// permanent once pushed, and they are usually somebody's private material.
// Deliberately NOT forbidden: .sog, .splat, .ksplat. Those are the shipped capture tiers
// (site/walk/assets/capture.sog, capture-mobile.sog, capture-lite.sog) — the whole point of
// this repo is to ship those. Do not add them here.
const FORBIDDEN = /\.(mp4|mov|avi|mkv|webm|m4v|ply)$/i;

const MAX_BYTES = 99 * 1024 * 1024; // GitHub refuses files over 100 MB; fail before a push, not during one.

// List the files this repo would actually ship: the git index when root is a repo (so a
// gitignored scratch file in scene/ or work/ never trips the checks below), or a plain
// filesystem walk otherwise (validateRepo is also called against roots built for tests that
// aren't git repos).
function listFiles(root) {
  if (fs.existsSync(path.join(root, ".git"))) {
    try {
      const out = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
      return out.split("\n").filter(Boolean);
    } catch {
      // fall through to the filesystem walk below
    }
  }
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else files.push(path.relative(root, full));
    }
  };
  walk(root);
  return files;
}

export function validateRepo(root) {
  const problems = [];
  for (const rel of REQUIRED) {
    if (!fs.existsSync(path.join(root, rel))) problems.push(`missing required file: ${rel}`);
  }

  const marketplacePath = path.join(root, ".claude-plugin/marketplace.json");
  if (fs.existsSync(marketplacePath)) {
    let m;
    try { m = JSON.parse(fs.readFileSync(marketplacePath, "utf8")); }
    catch (e) { problems.push(`marketplace.json is not valid JSON: ${e.message}`); }
    if (m) {
      for (const key of ["name", "description", "owner", "plugins"]) {
        if (!m[key]) problems.push(`marketplace.json is missing "${key}"`);
      }
      for (const p of m.plugins || []) {
        const src = path.join(root, p.source || "");
        if (!p.source || !fs.existsSync(src)) problems.push(`plugin "${p.name}" points at a missing source: ${p.source}`);
        const manifest = path.join(src, ".claude-plugin/plugin.json");
        if (fs.existsSync(src) && !fs.existsSync(manifest)) problems.push(`plugin "${p.name}" has no plugin.json`);
      }
    }
  }

  for (const rel of listFiles(root)) {
    const full = path.join(root, rel);
    if (FORBIDDEN.test(rel)) problems.push(`forbidden file in a public repo: ${rel}`);
    let size;
    try {
      ({ size } = fs.statSync(full));
    } catch (e) {
      if (e.code === "ENOENT") {
        // git ls-files reports the index, not the working tree: a plain `rm` (deletion not
        // staged) leaves the path listed but gone from disk. That disagreement is itself worth
        // publishing a report about, not silently skipping past.
        problems.push(`tracked file is missing from disk: ${rel}`);
      } else {
        problems.push(`could not read file: ${rel} (${e.message})`);
      }
      continue;
    }
    if (size > MAX_BYTES) problems.push(`file exceeds GitHub's 100 MB limit: ${rel} (${(size / (1024 * 1024)).toFixed(1)} MB)`);
  }

  return { ok: problems.length === 0, problems };
}
