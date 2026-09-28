import test from "node:test"; import assert from "node:assert/strict"; import { dockerArgs, detectGpu, DEFAULT_SHM_SIZE } from "../lib/docker.mjs";
test("docker args mount the video read-only, the scene folder and the weights volume, and pass the GPU when present", () => {
  const a = dockerArgs({ video: "/v/clip.mp4", out: "/o/scene", quality: "high", scale: 70, image: "img:1", gpu: "nvidia" });
  assert.deepEqual(a.slice(0, 5), ["run", "--rm", "--gpus", "all", "--shm-size"]); assert.ok(a.includes("/v/clip.mp4:/input/clip.mp4:ro")); assert.ok(a.includes("/o/scene:/work")); assert.ok(a.includes("splatsite-weights:/weights"));
  assert.deepEqual(a.slice(-6), ["img:1", "/input/clip.mp4", "--quality", "high", "--scale", "70"]);
  assert.ok(!dockerArgs({ video: "/v/c.mp4", out: "/o", quality: "fast", image: "i", gpu: null }).includes("--gpus"));
});
test("gpu detection reads docker runtimes", () => {
  assert.equal(detectGpu((cmd) => cmd.startsWith("docker info") ? '{"nvidia":{"path":"nvidia-container-runtime"}}' : ""), "nvidia");
  assert.equal(detectGpu(() => { throw new Error("no"); }), null);
});
test("SPLATSITE_IMAGE overrides DEFAULT_IMAGE", async () => {
  process.env.SPLATSITE_IMAGE = "registry.example/custom-recon:dev";
  try {
    // a fresh module instance (via a cache-busting query) picks up the env var at load time
    const mod = await import("../lib/docker.mjs?splatsite-image-test");
    assert.equal(mod.DEFAULT_IMAGE, "registry.example/custom-recon:dev");
  } finally {
    delete process.env.SPLATSITE_IMAGE;
  }
});

test("every run raises /dev/shm above Docker's 64 MB default, which `high` training cannot train in", () => {
  // The CPU path matters as much as the GPU one: the trainer's DataLoader is what exhausts
  // shared memory, and it uses worker processes whether or not a GPU is doing the maths.
  for (const gpu of ["nvidia", null]) {
    const a = dockerArgs({ video: "/v/clip.mp4", out: "/o/scene", quality: "high", image: "i", gpu });
    assert.equal(a[a.indexOf("--shm-size") + 1], DEFAULT_SHM_SIZE);
    assert.ok(a.indexOf("--shm-size") < a.indexOf("i"), "flags must precede the image name or docker reads them as container arguments");
  }
  const custom = dockerArgs({ video: "/v/clip.mp4", out: "/o/scene", quality: "high", image: "i", gpu: null, shmSize: "4g" });
  assert.equal(custom[custom.indexOf("--shm-size") + 1], "4g");
});

test("SPLATSITE_SHM_SIZE overrides DEFAULT_SHM_SIZE", async () => {
  process.env.SPLATSITE_SHM_SIZE = "24g";
  try {
    const mod = await import("../lib/docker.mjs?splatsite-shm-test");
    assert.equal(mod.DEFAULT_SHM_SIZE, "24g");
  } finally {
    delete process.env.SPLATSITE_SHM_SIZE;
  }
});

test("convert defaults to the fast quality level", () => {
  const a = dockerArgs({ video: "/v/clip.mp4", out: "/o/scene", quality: "fast", image: "i", gpu: null });
  assert.ok(a.includes("--quality") && a[a.indexOf("--quality") + 1] === "fast");
});
