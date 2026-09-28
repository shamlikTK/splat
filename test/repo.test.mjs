import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
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

test("a tracked file deleted from disk (deletion not staged) is reported, not thrown", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "splat-repo-test-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
    writeFileSync(path.join(dir, "gone.txt"), "tracked, then deleted without staging\n");
    execFileSync("git", ["add", "gone.txt"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "add gone.txt"], { cwd: dir });
    unlinkSync(path.join(dir, "gone.txt")); // `rm`, not `git rm` — the index still lists it

    const r = validateRepo(dir); // must not throw ENOENT
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes("gone.txt")), `expected a problem naming gone.txt, got: ${JSON.stringify(r.problems)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
