import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, fail } from "../lib/cli-util.mjs";

test("parseArgs: flag value at end of argv", () => {
  const result = parseArgs(["--out", "./scene"]);
  assert.deepEqual(result, { _: [], out: "./scene" });
});

test("parseArgs: positional before flag-value", () => {
  const result = parseArgs(["a", "--x", "1"]);
  assert.deepEqual(result, { _: ["a"], x: "1" });
});

test("parseArgs: flag without value followed by another flag", () => {
  const result = parseArgs(["--x", "--y"]);
  assert.deepEqual(result, { _: [], x: true, y: true });
});

test("parseArgs: positional after flag-value pair", () => {
  const result = parseArgs(["--x", "1", "b"]);
  assert.deepEqual(result, { _: ["b"], x: "1" });
});

test("fail creates an error with code 2", () => {
  const e = fail("test message");
  assert.equal(e.code, 2);
  assert.equal(e.message, "test message");
});
