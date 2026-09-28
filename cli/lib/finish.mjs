// splatsite/cli/lib/finish.mjs — host-side finish step for scenes the reconstruction container
// could not SOG-encode itself (no usable GPU encoder inside the container for a capture with
// spherical-harmonic bands: `--quality high`). Those scenes carry `capture*.ply` tiers plus an
// empty `sog-pending` marker instead of `.sog` files, even though the manifest names `.sog`
// files. This module runs the host's `splat-transform` (installed as a runtime dependency) on
// each PLY tier to finish the conversion.
// Exports:
//   finishScene(sceneDir, { exec } = {}) -> Promise<{ converted: string[] }>
//     If sceneDir has no `sog-pending` marker, returns { converted: [] } immediately (nothing
//     to do — also makes a second call after a full success a no-op). Otherwise, for every
//     `capture*.ply` in sceneDir, runs `splat-transform -w <ply> <same-name .sog>` (GPU
//     auto-detected by the tool: it prints "WebGPU is not available" and falls back to CPU on
//     its own). Deletes each PLY only once its .sog exists on disk with nonzero size, then
//     deletes the marker once every tier is converted — a tier that fails (nonzero exit, a
//     timeout, or success-but-no-output) leaves its own PLY and the marker in place, so a
//     partial failure is retriable via another `finishScene`/`splatsite finish <scene>` call
//     without losing already-converted tiers. `exec` is an injectable `(args, opts) -> {
//     status, signal, stdout, stderr, error }` (defaults to a real `spawnSync` of the bundled
//     splat-transform binary) for testability. Throws via `fail` (see cli-util.mjs), naming the
//     failing tier and a remedy, on a nonzero exit, a timeout, or a missing/empty output file.
//   main(argv) -> Promise<number>
//     CLI entry point for `splatsite finish <scene>`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, fail } from "./cli-util.mjs";

// Resolved relative to the package root (this file lives in <pkg>/lib/), not process.cwd(), so
// it works no matter where `splatsite` is invoked from.
const SPLAT_TRANSFORM = fileURLToPath(new URL("../node_modules/.bin/splat-transform", import.meta.url));

const MARKER = "sog-pending";
// The GPU-adapter probe is a quick enumeration; 60s is generous but bounded — the same figure
// pipeline/gpu_encoder.sh (the container-side counterpart) uses, and for the same reason: a
// hanging probe must not be able to hang the whole command.
const PROBE_TIMEOUT_MS = 60_000;
// A conversion can legitimately run for minutes on CPU with a multi-million-splat capture, but
// it must not be able to hang `convert`/`finish` forever if splat-transform itself wedges.
const CONVERT_TIMEOUT_MS = 3 * 60 * 60 * 1000;

// A signal alone doesn't mean the run timed out -- `docker stop`, an OOM kill, or an operator's
// own `kill` can all send SIGTERM/SIGKILL to a long-running conversion. Only call it a timeout
// when spawnSync's own timeout mechanism fired (it sets error.code === "ETIMEDOUT"), or as a
// fallback for an injected `exec` that doesn't model that: the exact signal spawnSync's timeout
// sends (SIGTERM) together with an elapsed time that reached the timeout.
function timedOut(r, elapsedMs, timeoutMs) {
  if (r.error?.code === "ETIMEDOUT") return true;
  return r.signal === "SIGTERM" && elapsedMs >= timeoutMs;
}

export async function finishScene(sceneDir, { exec } = {}) {
  const markerPath = path.join(sceneDir, MARKER);
  if (!fs.existsSync(markerPath)) return { converted: [] };

  const run = exec || ((args, opts = {}) => {
    const r = spawnSync(SPLAT_TRANSFORM, args, { encoding: "utf8", ...opts });
    return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr, error: r.error };
  });

  // Probe for a GPU adapter up front so we can warn once instead of per tier; the conversion
  // itself auto-detects (no -g flag), so this probe only controls the warning message. A
  // timed-out or failed probe has no adapter line in its (possibly partial) stdout, so it falls
  // through to the same "no adapter" warning as a clean "none found" result — no special-casing
  // needed here.
  const probe = run(["--list-gpus"], { stdio: ["ignore", "pipe", "pipe"], timeout: PROBE_TIMEOUT_MS });
  const hasAdapter = /^\[\d+\]/m.test(probe.stdout || "");
  if (!hasAdapter) {
    console.warn("splatsite finish: no GPU adapter found for splat-transform (CPU encoding) — a large scene can take a very long time");
  }

  const plys = fs.readdirSync(sceneDir).filter((f) => /^capture.*\.ply$/.test(f)).sort();
  const converted = [];
  for (const ply of plys) {
    const sog = ply.replace(/\.ply$/, ".sog");
    const src = path.join(sceneDir, ply);
    const dst = path.join(sceneDir, sog);
    const t0 = Date.now();
    const r = run(["-w", src, dst], { stdio: "inherit", timeout: CONVERT_TIMEOUT_MS });
    const elapsedMs = Date.now() - t0;
    if (timedOut(r, elapsedMs, CONVERT_TIMEOUT_MS)) {
      throw fail(`splat-transform timed out converting ${ply} to ${sog} after ${CONVERT_TIMEOUT_MS / 3_600_000}h — rerun 'splatsite finish ${sceneDir}', try --cpu, or check the GPU with 'splat-transform --list-gpus'`, 1);
    }
    if (r.signal) {
      throw fail(`splat-transform was killed by signal ${r.signal} converting ${ply} to ${sog} (not a timeout — something else terminated it, e.g. 'docker stop' or an out-of-memory kill) — rerun 'splatsite finish ${sceneDir}' once the cause is addressed`, 1);
    }
    if (r.status !== 0) {
      throw fail(`splat-transform failed converting ${ply} to ${sog} — check the output above; is the PLY complete/uncorrupted? Rerun 'splatsite finish ${sceneDir}' once fixed`, 1);
    }
    if (!fs.existsSync(dst) || fs.statSync(dst).size === 0) {
      throw fail(`splat-transform reported success but wrote no ${sog} — rerun 'splatsite finish ${sceneDir}'; the PLY was kept`, 1);
    }
    fs.unlinkSync(src);
    converted.push(sog);
  }

  // Only clear the marker when this call actually finished something, or (if there was nothing
  // to convert — plys was already empty) the scene looks genuinely done: no PLY tiers left and
  // capture.sog present. Otherwise the scene is in an unexplained state (marker present, no
  // tiers to convert, but no capture.sog either) -- fail loudly rather than silently clearing
  // the marker over what might be a corrupted/incomplete scene folder.
  if (converted.length === 0 && !fs.existsSync(path.join(sceneDir, "capture.sog"))) {
    throw fail(`${sceneDir} has a "${MARKER}" marker but no capture*.ply tiers to convert and no capture.sog — the scene looks incomplete or corrupted; rerun 'splatsite convert', or restore the missing capture files, then retry 'splatsite finish ${sceneDir}'`, 1);
  }
  fs.unlinkSync(markerPath);
  return { converted };
}

export async function main(argv) {
  const a = parseArgs(argv);
  const scene = a._[0];
  if (!scene) throw fail("usage: splatsite finish <scene>");
  const abs = path.resolve(scene);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw fail(`${scene} is not a directory`);
  const r = await finishScene(abs);
  console.log(r.converted.length ? `finished ${r.converted.length} tier(s): ${r.converted.join(", ")}` : `${scene}: no pending SOG encoding`);
  return 0;
}
