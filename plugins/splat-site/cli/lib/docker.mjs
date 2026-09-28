// splatsite/cli/lib/docker.mjs — Docker driver for the reconstruction container.
// Exports: DEFAULT_IMAGE, detectGpu(exec), dockerArgs(opts), main(argv)
// main() also runs the host-side finish step (lib/finish.mjs) after a successful container
// exit, so a `high`-quality scene the container left as PLY tiers + `sog-pending` (no usable
// GPU encoder inside the container) gets SOG-encoded on the host in the same command.
// DEFAULT_IMAGE can be overridden by the SPLATSITE_IMAGE environment variable (without
// touching --image on every invocation); --image still wins over both when given.
// DEFAULT_SHM_SIZE is the same story for SPLATSITE_SHM_SIZE and --shm-size.

import { execSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs, fail } from "./cli-util.mjs";
import { finishScene } from "./finish.mjs";

export const DEFAULT_IMAGE = process.env.SPLATSITE_IMAGE || "ghcr.io/shamlikt/splatsite-recon:latest";

// Docker gives a container 64 MB of /dev/shm by default, and `high` training cannot run in it:
// the gsplat trainer's DataLoader hands decoded frames back from its worker processes through
// shared memory, so a 1080p capture exhausts 64 MB within the first few steps and torch raises
// `unable to allocate shared memory (shm) ... No space left on device (28)` — which names a
// device, not the disk, and reads like a full filesystem when nothing is full. `fast` and
// `balanced` are feed-forward and never hit it, so the failure only ever appears on `high`.
// This is a ceiling on a tmpfs rather than an allocation: an unused gigabyte costs nothing, so
// the default is set well clear of what the trainer needs instead of tuned to it.
export const DEFAULT_SHM_SIZE = process.env.SPLATSITE_SHM_SIZE || "16g";

/**
 * Detect if NVIDIA GPU is available for Docker.
 * Checks `docker info` for nvidia runtime, then `nvidia-smi`.
 * @param {Function} exec - executor function (defaults to execSync)
 * @returns {"nvidia"|null}
 */
export function detectGpu(exec = (c) => execSync(c, { stdio: ["ignore", "pipe", "ignore"] }).toString()) {
  try {
    if (/nvidia/i.test(exec("docker info --format '{{json .Runtimes}}'"))) return "nvidia";
  } catch {}
  try {
    if (exec("nvidia-smi -L")) return "nvidia";
  } catch {}
  return null;
}

/**
 * Build docker run arguments for the reconstruction container.
 * @param {Object} opts - { video, out, quality, scale, frames, image, gpu, cpu, shmSize }
 * @returns {string[]} argv after `docker`
 */
export function dockerArgs({ video, out, quality, scale = 100, frames, image, gpu, cpu = false, shmSize = DEFAULT_SHM_SIZE }) {
  const inName = path.basename(video);
  const a = ["run", "--rm"];
  if (gpu && !cpu) a.push("--gpus", "all");
  a.push("--shm-size", shmSize);
  a.push("-v", `${video}:/input/${inName}:ro`, "-v", `${out}:/work`, "-v", "splatsite-weights:/weights", image, `/input/${inName}`, "--quality", quality, "--scale", String(scale));
  if (frames) a.push("--frames", String(frames));
  if (cpu) a.push("--device", "cpu");
  return a;
}

/**
 * Main entry point for the convert command.
 * Orchestrates Docker pull, validation, and container run.
 * @param {string[]} argv - command arguments
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const a = parseArgs(argv);
  const video = a._[0];
  if (!video) throw fail("usage: splatsite convert <video> [--quality fast|balanced|high] [--scale N] [--frames N] [--out ./scene] [--image TAG] [--shm-size SIZE] [--cpu]");
  // `fast` is the default because it is the only level that works on every host (a CPU-only
  // machine cannot train) and it turns a clip into a scene in minutes rather than an hour.
  // Ask for `high` when the capture itself is the point of the site.
  const quality = a.quality || "fast";
  if (!["fast", "balanced", "high"].includes(quality)) throw fail(`unknown --quality ${quality}: expected fast, balanced or high`);

  // Checked here rather than left to Docker: an unparseable size is rejected only once the
  // daemon has been handed the run, which on a resumed scene is minutes of stage checks away.
  const shmSize = a["shm-size"] === undefined ? DEFAULT_SHM_SIZE : String(a["shm-size"]);
  if (!/^\d+(\.\d+)?[bkmg]$/i.test(shmSize)) throw fail(`unusable --shm-size ${shmSize}: expected a number with a b/k/m/g suffix, e.g. 16g`);

  if (!fs.existsSync(video)) throw fail(`video not found: ${video}`);

  try {
    execSync("docker version", { stdio: "ignore" });
  } catch {
    throw fail("Docker is required and not running: install Docker Desktop (Mac/Windows) or Docker Engine (Linux) and start it");
  }

  const out = path.resolve(a.out || "scene");
  fs.mkdirSync(out, { recursive: true });

  const gpu = a.cpu ? null : detectGpu();
  const image = a.image || DEFAULT_IMAGE;

  console.log(`splatsite convert: ${gpu ? "NVIDIA GPU detected" : "no GPU runtime: running on CPU (fast only)"}; image ${image}`);

  // Check if image exists; pull if not
  if (spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status !== 0) {
    console.log(`pulling ${image} (this is about 20 GB; once)`);
    const p = spawn("docker", ["pull", image], { stdio: "inherit" });
    const c = await new Promise((r) => p.on("close", r));
    if (c) throw fail(`could not pull ${image}: check the tag or build it locally with splatsite/docker/build.sh`);
  }

  // Run the container
  const dargs = dockerArgs({
    video: path.resolve(video),
    out,
    quality,
    scale: a.scale ? +a.scale : 100,
    frames: a.frames ? +a.frames : undefined,
    image,
    gpu,
    cpu: !!a.cpu,
    shmSize,
  });

  const code = await new Promise((r) => spawn("docker", dargs, { stdio: "inherit" }).on("close", r));

  if (code === 0) {
    const { converted } = await finishScene(out);
    if (converted.length) console.log(`finished SOG encoding on the host: ${converted.length} tier(s) (${converted.join(", ")})`);
    // The container runs as root by default, so files it wrote under `out` may be root-owned on
    // the host; a later `build`/`serve` running as a normal user would then fail to read them.
    if (fs.statSync(out).uid !== process.getuid()) {
      console.log(`note: ${out} is owned by another user (the container ran as root) — if later commands can't read it, run: sudo chown -R $(id -u):$(id -g) ${out}`);
    }
    console.log(`scene written to ${out}. Next: edit ${path.join(out, "manifest.json")} (spots, copy), then 'splatsite build ${a.out || "scene"} --photos <dir>'`);
  } else if (code === 2) {
    console.error(`refused by the image; see the message above`);
  } else {
    console.error(`reconstruction failed (exit ${code}); see ${path.join(out, "reconstruct.log")}. Rerun the same command to resume from the last finished stage.`);
  }

  return code;
}
