import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCli } from "../scripts/scene-lib.mjs";

// A fake installed plugin: <root>/cli next to <root>/skills/splat-site/scripts
function fakePlugin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "splat-plugin-"));
  fs.mkdirSync(path.join(root, "cli/lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "cli/template"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/lib/manifest.mjs"), "export const x = 1;\n");
  fs.writeFileSync(path.join(root, "cli/template/splat.js"), "// splat\n");
  return root;
}

test("SPLATSITE_CLI wins over everything", () => {
  const root = fakePlugin();
  const prev = process.env.SPLATSITE_CLI;
  process.env.SPLATSITE_CLI = path.join(root, "cli");
  try { assert.equal(resolveCli(), path.join(root, "cli")); }
  finally { if (prev === undefined) delete process.env.SPLATSITE_CLI; else process.env.SPLATSITE_CLI = prev; }
});

test("the plugin's own cli/ is found from the skill's location", () => {
  // resolveCli must look relative to this module, not to the working directory,
  // because an installed skill runs from wherever the user happens to be.
  const prev = process.env.SPLATSITE_CLI;
  delete process.env.SPLATSITE_CLI;
  try {
    const found = resolveCli();
    assert.ok(fs.existsSync(path.join(found, "lib/manifest.mjs")), `resolved ${found} has no lib/manifest.mjs`);
    assert.ok(fs.existsSync(path.join(found, "template/splat.js")), `resolved ${found} has no template/splat.js`);
  } finally { if (prev !== undefined) process.env.SPLATSITE_CLI = prev; }
});

test("no personal path is baked into the resolver", () => {
  const src = fs.readFileSync(new URL("../scripts/scene-lib.mjs", import.meta.url), "utf8");
  assert.equal(/random\/3dspacial/.test(src), false, "the resolver still contains a machine-specific path");
});
