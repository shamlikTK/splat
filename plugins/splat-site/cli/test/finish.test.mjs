// splatsite/cli/test/finish.test.mjs — tests for lib/finish.mjs (host-side SOG finishing step).
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { makeScene } from "./fixtures/make-scene.mjs";
import { finishScene } from "../lib/finish.mjs";
import { buildSite } from "../lib/build.mjs";

// A tiny but valid SH0 PLY, same shape as the one test/fixtures/make-scene.mjs writes — enough
// for splat-transform to convert to .sog quickly.
function writeTinyPly(file) {
  const n = 200;
  const props = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\n${props.map((p) => `property float ${p}`).join("\n")}\nend_header\n`;
  const buf = Buffer.alloc(n * props.length * 4);
  let o = 0, seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const v = [rnd() * 2 - 1, rnd() * 1 - 0.8, rnd() * 4, rnd(), rnd(), rnd(), 2, -4, -4, -4, 1, 0, 0, 0];
    for (const x of v) { buf.writeFloatLE(x, o); o += 4; }
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(header), buf]));
}

test("finishScene converts capture*.ply tiers to .sog, deletes the PLYs, and clears the marker", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "finish-"));
  writeTinyPly(path.join(d, "capture.ply"));
  writeTinyPly(path.join(d, "capture-lite.ply"));
  fs.writeFileSync(path.join(d, "sog-pending"), "");

  const r = await finishScene(d);

  assert.deepEqual(r.converted.slice().sort(), ["capture-lite.sog", "capture.sog"]);
  assert.ok(fs.existsSync(path.join(d, "capture.sog")), "capture.sog should exist");
  assert.ok(fs.existsSync(path.join(d, "capture-lite.sog")), "capture-lite.sog should exist");
  assert.ok(!fs.existsSync(path.join(d, "capture.ply")), "capture.ply should be deleted");
  assert.ok(!fs.existsSync(path.join(d, "capture-lite.ply")), "capture-lite.ply should be deleted");
  assert.ok(!fs.existsSync(path.join(d, "sog-pending")), "marker should be deleted");
});

test("finishScene is a no-op on a scene with no sog-pending marker", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "finish-"));
  writeTinyPly(path.join(d, "capture.ply")); // present but should be left untouched
  const r = await finishScene(d);
  assert.deepEqual(r.converted, []);
  assert.ok(fs.existsSync(path.join(d, "capture.ply")), "capture.ply must survive when there is no marker");
});

test("buildSite refuses a scene with a pending sog-pending marker", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "site-")); const scene = path.join(d, "scene"); await makeScene(scene);
  fs.writeFileSync(path.join(scene, "sog-pending"), "");
  await assert.rejects(buildSite({ scene, photos: path.join(scene, "pics"), out: path.join(d, "site") }), (e) => e.code === 2);
});

// A fake splat-transform for the `exec` injection point: no real binary is invoked, so these
// tests exercise finishScene's own control flow (ordering, partial-failure bookkeeping,
// idempotency, the no-adapter warning) without needing a real failure or a slow real encode.
//   adapter: whether the "--list-gpus" probe reports a GPU line.
//   fail: basename of a source .ply whose "conversion" should report a nonzero exit.
//   empty: basename of a source .ply whose "conversion" should report success but write nothing.
function stubExec({ adapter = true, fail: failBase = null, empty: emptyBase = null } = {}) {
  return (args) => {
    if (args[0] === "--list-gpus") return { status: 0, stdout: adapter ? "[0] Fake GPU\n" : "no adapters found\n" };
    const [, src, dst] = args; // ["-w", src, dst]
    const base = path.basename(src);
    if (base === failBase) return { status: 1, stdout: "", stderr: "boom" };
    if (base === emptyBase) return { status: 0 }; // "succeeded" but wrote no output file
    fs.writeFileSync(dst, "fake-sog-bytes");
    return { status: 0 };
  };
}

test("a failing tier keeps its PLY and the marker, leaves the earlier tier converted, and rejects with code 1", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "finish-"));
  // sorted order is capture-lite.ply, then capture.ply ("-" < "." in ASCII) — fail the second.
  writeTinyPly(path.join(d, "capture-lite.ply"));
  writeTinyPly(path.join(d, "capture.ply"));
  fs.writeFileSync(path.join(d, "sog-pending"), "");

  await assert.rejects(finishScene(d, { exec: stubExec({ fail: "capture.ply" }) }), (e) => e.code === 1);

  assert.ok(fs.existsSync(path.join(d, "capture-lite.sog")), "the earlier, successful tier's .sog should exist");
  assert.ok(!fs.existsSync(path.join(d, "capture-lite.ply")), "the earlier tier's .ply should have been deleted");
  assert.ok(fs.existsSync(path.join(d, "capture.ply")), "the failing tier's .ply must survive");
  assert.ok(!fs.existsSync(path.join(d, "capture.sog")), "the failing tier must not produce a .sog");
  assert.ok(fs.existsSync(path.join(d, "sog-pending")), "the marker must survive a partial failure, so a retry can pick up where it left off");
});

test("finishScene is idempotent: a second call after a full success returns converted: [] and touches nothing", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "finish-"));
  writeTinyPly(path.join(d, "capture.ply"));
  fs.writeFileSync(path.join(d, "sog-pending"), "");

  const first = await finishScene(d, { exec: stubExec() });
  assert.deepEqual(first.converted, ["capture.sog"]);
  const sogBefore = fs.readFileSync(path.join(d, "capture.sog"));

  const second = await finishScene(d, { exec: stubExec() });
  assert.deepEqual(second.converted, []);
  assert.deepEqual(fs.readFileSync(path.join(d, "capture.sog")), sogBefore, "capture.sog must be untouched by the no-op call");
  assert.ok(!fs.existsSync(path.join(d, "sog-pending")));
});

test("finishScene warns once when splat-transform reports no GPU adapter", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "finish-"));
  writeTinyPly(path.join(d, "capture.ply"));
  fs.writeFileSync(path.join(d, "sog-pending"), "");

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  try {
    await finishScene(d, { exec: stubExec({ adapter: false }) });
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((w) => /no GPU adapter/i.test(w)), `expected a no-adapter warning, got: ${JSON.stringify(warnings)}`);
});

test("finishScene refuses to delete the PLY when splat-transform reports success but writes nothing", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "finish-"));
  writeTinyPly(path.join(d, "capture.ply"));
  fs.writeFileSync(path.join(d, "sog-pending"), "");

  await assert.rejects(finishScene(d, { exec: stubExec({ empty: "capture.ply" }) }), (e) => e.code === 1);
  assert.ok(fs.existsSync(path.join(d, "capture.ply")), "the PLY must be kept when no output was actually written");
  assert.ok(fs.existsSync(path.join(d, "sog-pending")), "the marker must survive so this is retriable");
});

test("finishScene reports a timeout distinctly and keeps the PLY and marker", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "finish-"));
  writeTinyPly(path.join(d, "capture.ply"));
  fs.writeFileSync(path.join(d, "sog-pending"), "");

  const exec = (args) => {
    if (args[0] === "--list-gpus") return { status: 0, stdout: "[0] Fake GPU\n" };
    // what spawnSync actually reports when its own `timeout` option fires: both a signal and
    // error.code === "ETIMEDOUT" (verified against a real `spawnSync(..., {timeout})` call).
    return { status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" } };
  };
  await assert.rejects(finishScene(d, { exec }), (e) => e.code === 1 && /timed out/.test(e.message));
  assert.ok(fs.existsSync(path.join(d, "capture.ply")));
  assert.ok(fs.existsSync(path.join(d, "sog-pending")));
});

test("finishScene distinguishes an external kill signal from a timeout", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "finish-"));
  writeTinyPly(path.join(d, "capture.ply"));
  fs.writeFileSync(path.join(d, "sog-pending"), "");

  const exec = (args) => {
    if (args[0] === "--list-gpus") return { status: 0, stdout: "[0] Fake GPU\n" };
    // e.g. `docker stop`, or an OOM killer -- a signal with no ETIMEDOUT error and (in the real
    // world) an elapsed time far short of the multi-hour conversion timeout.
    return { status: null, signal: "SIGTERM" };
  };
  await assert.rejects(finishScene(d, { exec }), (e) => e.code === 1 && /killed by signal SIGTERM/.test(e.message) && !/timed out/.test(e.message));
  assert.ok(fs.existsSync(path.join(d, "capture.ply")));
  assert.ok(fs.existsSync(path.join(d, "sog-pending")));
});

test("finishScene refuses to clear the marker when there is nothing to convert and no capture.sog", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "finish-"));
  // sog-pending present, but no capture*.ply tiers and no capture.sog -- a corrupted/incomplete scene.
  fs.writeFileSync(path.join(d, "sog-pending"), "");

  await assert.rejects(finishScene(d, { exec: stubExec() }), (e) => e.code === 1 && /incomplete or corrupted/.test(e.message));
  assert.ok(fs.existsSync(path.join(d, "sog-pending")), "the marker must survive so the problem is visible on retry");
});

test("finishScene clears the marker when there's nothing left to convert but capture.sog already exists", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "finish-"));
  // A scene that finished converting on some earlier, interrupted call: capture.sog exists, no
  // PLYs remain, but the marker was never cleared.
  fs.writeFileSync(path.join(d, "capture.sog"), "already-converted-bytes");
  fs.writeFileSync(path.join(d, "sog-pending"), "");

  const r = await finishScene(d, { exec: stubExec() });
  assert.deepEqual(r.converted, []);
  assert.ok(!fs.existsSync(path.join(d, "sog-pending")), "the marker should be cleared: nothing to convert, and capture.sog already exists");
});
