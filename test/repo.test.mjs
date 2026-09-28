import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRepo } from "../scripts/validate-repo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the repository is a valid marketplace with one plugin", () => {
  const r = validateRepo(ROOT);
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
});

test("no video or reconstruction source ships", () => {
  const r = validateRepo(ROOT);
  assert.equal(r.problems.filter((p) => /forbidden file/.test(p)).length, 0);
});
