// scripts/validate-repo.mjs — check the repository is a well-formed marketplace before release.
// Exports: validateRepo(root) -> { ok, problems }
import fs from "node:fs";
import path from "node:path";

const REQUIRED = [
  ".claude-plugin/marketplace.json",
  "plugins/splat-site/.claude-plugin/plugin.json",
  "plugins/splat-site/skills/splat-site/SKILL.md",
  "cli/bin/splatsite.mjs",
  "cli/package.json",
  "docker/Dockerfile",
  "README.md",
  "LICENSE",
];

// A distribution repo must never carry footage or reconstructions: they are large, they are
// permanent once pushed, and they are usually somebody's private material.
const FORBIDDEN = /\.(mp4|mov|avi|ply)$/i;

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

  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (FORBIDDEN.test(e.name)) problems.push(`forbidden file in a public repo: ${path.relative(root, full)}`);
    }
  };
  walk(root);

  return { ok: problems.length === 0, problems };
}
