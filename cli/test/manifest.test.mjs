import test from "node:test";
import assert from "node:assert/strict";
import { frameOf, resolve, albumMarkup, pageConfig, loadManifest } from "../lib/manifest.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const F = { up: [0, -1, 0], fwd: [0, 0, 1], right: [-1, 0, 0], origin: [0, 0, 0], fwd0: 0, fwd1: 4 };
const M = {
  title: "T",
  photosDir: "photos",
  frame: F,
  ground: { point: [0, 0, 0] },
  capture: "capture.sog",
  config: { desktop: { file: "capture.sog" } },
  poses: {
    gate: { eye: [0, -0.2, 0], target: { t: 0.5, a: 0, h: 0.2 } },
    rise: { eye: [0, -2, 0], target: [0, 0, 2] },
    close: { eye: [0, -1, -1], target: [0, 0, 2] },
  },
  spots: [
    {
      label: "A",
      pin: { t: 0.25, a: 0.5, h: 0.1 },
      photos: [{ file: "a.jpg", title: "Photo A", w: 480, h: 640 }],
    },
  ],
};

test("resolve maps frame coordinates onto the ground plane", () => {
  assert.deepEqual(resolve({ t: 0.25, a: 0, h: 0 }, F, [0, 0, 0]), [0, 0, 1]); // a quarter along a 4-unit path
  assert.deepEqual(resolve({ t: 0, a: 0, h: 0.5 }, F, [0, 0, 0]), [0, -0.5, 0]); // h goes up = -y
  assert.deepEqual(resolve([1, 2, 3], F, [0, 0, 0]), [1, 2, 3]);
});

test("album markup carries the resolved pin as a data attribute", () => {
  const html = albumMarkup(M, F, [0, 0, 0]);
  assert.match(html, /data-pin="-0.5 -0.1 1"/);
  assert.match(html, /photos\/a-thumb.jpg/);
  assert.match(html, /Photo A/);
});

test("page config resolves poses and carries the frame", () => {
  const c = pageConfig(M, F, [0, 0, 0]);
  assert.deepEqual(c.poses.gate.target, [0, -0.2, 2]);
  assert.deepEqual(c.frame.up, [0, -1, 0]);
  assert.equal(c.file, "capture.sog");
});

test("loadManifest reports a missing required key with exit code 2", () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ss-")), "m.json");
  fs.writeFileSync(p, JSON.stringify({ title: "x" }));
  assert.throws(
    () => loadManifest(p),
    (e) => e.code === 2 && /frame/.test(e.message),
  );
});

function writeManifest(overrides) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ss-")), "m.json");
  fs.writeFileSync(p, JSON.stringify({ ...M, ...overrides }));
  return p;
}

test("loadManifest rejects a non-array spots with a step+remedy message", () => {
  assert.throws(
    () => loadManifest(writeManifest({ spots: { not: "an array" } })),
    (e) => e.code === 2 && /"spots"/.test(e.message) && /array/.test(e.message),
  );
});

test("loadManifest rejects a frame whose up/fwd aren't 3-number arrays", () => {
  assert.throws(
    () => loadManifest(writeManifest({ frame: { ...F, up: [0, -1] } })),
    (e) => e.code === 2 && /frame\.up/.test(e.message),
  );
  assert.throws(
    () => loadManifest(writeManifest({ frame: { ...F, fwd: "forward" } })),
    (e) => e.code === 2 && /frame\.fwd/.test(e.message),
  );
});

test("loadManifest rejects a pose eye/target that is neither a [x,y,z] array nor a {t,a,h} object", () => {
  assert.throws(
    () => loadManifest(writeManifest({ poses: { ...M.poses, gate: { eye: "nope", target: [0, 0, 1] } } })),
    (e) => e.code === 2 && /poses\.gate/.test(e.message),
  );
  assert.throws(
    () => loadManifest(writeManifest({ poses: { ...M.poses, rise: { eye: [0, -2, 0], target: { a: 0, h: 0 } } } })), // missing t
    (e) => e.code === 2 && /poses\.rise/.test(e.message),
  );
});

test("loadManifest accepts poses given as raw [x,y,z] arrays or {t,a,h} objects", () => {
  assert.doesNotThrow(() => loadManifest(writeManifest({})));
});
