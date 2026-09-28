# splatsite reconstruction image

`splatsite-recon:dev` turns a video into a scene folder (the "scene contract") inside one container: frame
extraction, pose/geometry recovery, Gaussian-splat training, and SOG publishing. Build from the repo root:

```bash
docker build -f splatsite/docker/Dockerfile -t splatsite-recon:dev .
# or: bash splatsite/docker/build.sh
```

The image is CUDA 13 + COLMAP + gsplat (compiled from source, the slow ~45 min layer) + Tencent WorldMirror 2.0 +
`splat-transform`. It is native-arch by default (`TORCH_CUDA_ARCH_LIST=12.0`, matching this DGX Spark's GB10);
the other architecture and version pins are handled by CI, not this local build.

## Running it

```bash
docker run --rm --gpus all --shm-size=8g \
  -v $PWD/input/myvideo.mp4:/in.mp4:ro \
  -v $PWD/splatsite/out-myscene:/work \
  -v splatsite-weights:/weights \
  splatsite-recon:dev /in.mp4 --quality fast
```

`--shm-size=8g` matters for `--quality high`: Docker's default `/dev/shm` is 64 MB, and gsplat's training
dataloader (4 worker processes, shared-memory tensor handoff) needs more than that once the model reaches a few
hundred thousand Gaussians — without it, `train` fails with `unable to allocate shared memory(shm) ... No space
left on device`. `fast`/`balanced` don't train, so they don't need it, but it's harmless to always pass it.

Entry point: `reconstruct.py <video> --quality fast|balanced|high [--scale N] [--frames N] [--device auto|cuda|cpu] [--out /work]`.

- `--quality`: `fast` and `balanced` run Tencent WorldMirror 2.0 (feed-forward, no COLMAP); `high` runs
  COLMAP + 30k-step gsplat training. Every level has a built-in default frame count that `--frames`
  overrides: `high` defaults to 280; `fast`/`balanced` default to 32 (16 on CPU, to keep it tractable
  without a GPU). See the size/quality/speed tradeoffs in the top-level project README.
- `--scale N` (20-100, default 100): percent of the (already 1600px-capped) frame width; lower is faster.
- `--out` (default `/work`): where the scene contract is written.
- `--device`: `auto` (default) detects CUDA; force `cpu` to test the CPU path.

Output, written to the `-v ...:/work` mount, is the scene contract:
`cameras.json`, `bounds.json`, `manifest.json`, `reconstruct.log`, and — only on a GPU (CUDA) run — `posters/desktop.jpg`,
`posters/mobile.jpg` (rendered with gsplat from a capture camera; there is no CPU path for that render). On a CPU-only
run the `posters` stage is skipped entirely; `splatsite build` notices the missing poster files and substitutes an SVG
placeholder (the manifest's `theme.ground` color) instead of failing.
Plus either:
- `capture.sog`, `capture-mobile.sog`, `capture-lite.sog` — the normal case, ready to view, or
- `capture.ply`, `capture-mobile.ply`, `capture-lite.ply` plus an empty `sog-pending` marker — when this
  container had no GPU SOG encoder available for a capture with spherical-harmonic bands (see below); a
  host-side `splatsite convert` finishes SOG encoding from the PLY tiers.

Verify a `.sog` (or `.ply`) with:

```bash
splatsite/cli/node_modules/.bin/splat-transform splatsite/out-myscene/capture.sog --info null
```

Every stage is resumable under `/work/stages/`: a finished stage's marker is checked against its declared
inputs/outputs, and a rerun of the same command prints `up to date, skipped` for anything still fresh. A failed
stage leaves earlier stages' work in place — fix the cause (see `/work/reconstruct.log`) and rerun the same command.

## Weights volume

`fast`/`balanced` need Tencent HY-World-2.0 (~5 GB), fetched into the named volume on first use
(`HF_HOME=/weights` inside the container, so the cache lands at `/weights/hub`). Reuse one volume across runs so
it downloads once:

```bash
docker volume create splatsite-weights
```

To avoid the download entirely, seed it from an existing host-side `hf` cache (e.g. one built by
`scripts/setup_worldmirror.sh`):

```bash
docker run --rm -v splatsite-weights:/weights -v $PWD/tools/hf-cache/hub:/src:ro alpine sh -c \
  'mkdir -p /weights/hub && cp -r /src/models--tencent--HY-World-2.0 /weights/hub/'
```

`high` needs no weights download — COLMAP and gsplat are both classical/open-source, nothing pretrained to fetch.

## GPU memory guard

Every GPU stage calls `pipeline/check_gpu_memory.py <needed_gb> <stage>` before doing real work. On the DGX
Spark's unified memory, starting a stage without enough allocatable memory does not fail cleanly — it thrashes and
can freeze terminals or kill unrelated processes — so the guard asks first and refuses instead:

```
<stage>: needs about 20 GB of GPU memory but only 4.2 GB of 122 GB is allocatable. Other GPU users: VLLM::EngineCore, 5986 MiB.
Stop them (e.g. `docker stop <vllm container>`) or drop the page cache (`sudo sysctl vm.drop_caches=3`) and retry.
```

Check before a `high`-quality run on a shared box: `.venv/bin/python pipeline/check_gpu_memory.py 20 precheck`.

## SOG publishing and the PLY-tier fallback

`pipeline/publish_tiers.sh` compresses the trained Gaussians to `.sog` (small, ready for the browser viewer).
That compression can use a GPU (`splat-transform`'s WebGPU backend) or fall back to CPU — but only for captures
with no spherical-harmonic (SH) bands, which is exactly the `fast`/`balanced` WorldMirror output. A `high`-quality
capture has SH bands (view-dependent color from 30k steps of training), and CPU SOG compression of an SH3 capture
at a few million Gaussians is impractical (it did not finish overnight on this box). This container also has no
usable GPU encoder: `splat-transform --list-gpus` finds no Vulkan adapter for Dawn/WebGPU even with
`NVIDIA_DRIVER_CAPABILITIES=all` set (the NVIDIA Vulkan ICD fails to load) — a container/driver limitation, not
something a pipeline change can fix.

So `publish_tiers.sh` probes once (`splat-transform --list-gpus`) and branches:

- a real GPU adapter is available → SOG tiers as normal, on the GPU;
- no adapter, but the source has 0 SH bands → SOG tiers as normal, on the CPU (fast regardless);
- no adapter and SH bands > 0 (a `high`-quality capture, in this container) → PLY tiers
  (`capture.ply`, `capture-mobile.ply`, `capture-lite.ply`) plus an empty `sog-pending` marker file, and exit 0.
  Finish the conversion later, on a machine with a working GPU (e.g. the host: `splat-transform --list-gpus`
  should show `[0] NVIDIA GB10` there), with `pipeline/sog_encode.sh <in.ply> <out.sog>` per tier.

Override the probe with `SPLAT_TRANSFORM_GPU=cpu` (forces the CPU/PLY-fallback path regardless of what's
actually available — used by `tests/test_publish_tiers.sh` for a deterministic test).

## License note

- `fast` and `balanced` route through Tencent HY-World-2.0, under the **Tencent HY-WORLD 2.0 Community License
  Agreement** — a non-standard license that **excludes the European Union, United Kingdom, and South Korea**
  (use, reproduction, and distribution of the weights, code, and outputs is unlicensed outside its "Territory").
  Redistributing outputs requires the notice text specified in the license; see `tools/worldmirror/License.txt`.
- `high` uses only COLMAP (BSD) and gsplat (Apache-2.0) — no territory restriction, standard open-source terms.

Pick `high` if the Tencent license's territory carve-out is a problem for your use case.

## CPU behaviour

`--device auto` (default) detects CUDA at start. With no GPU visible (`--device cpu`, or `-e CUDA_VISIBLE_DEVICES=""`
and no `--gpus` flag on `docker run`):

- `--quality high` is refused immediately (exit code 2): Gaussian-splat training is CUDA-only, so there is no
  correct CPU fallback for it.
  ```
  refused: quality 'high' needs an NVIDIA GPU (Gaussian-splat training is CUDA-only) and this host has none. Use --quality fast, or run on a GPU machine.
  ```
- `--quality fast` runs on CPU (WorldMirror 2.0 feed-forward inference), at a reduced default of 16 frames / 700px
  to keep it tractable. Expect roughly 10-30 minutes on a modern CPU; there is no GPU-memory guard on this path
  since no GPU is used.

```bash
docker run --rm -e CUDA_VISIBLE_DEVICES="" \
  -v $PWD/input/myvideo.mp4:/in.mp4:ro -v $PWD/splatsite/out-myscene:/work -v splatsite-weights:/weights \
  splatsite-recon:dev /in.mp4 --quality fast
```
