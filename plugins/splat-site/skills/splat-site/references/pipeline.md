# The reconstruction half

Everything here is about turning a video into a scene folder. Read it before running a
conversion, and again when one goes wrong.

## The CLI

`splatsite` ships inside this plugin at `<plugin>/cli`, and the scripts here find it there
automatically. It may also be on `PATH`; otherwise run `node <cli>/bin/splatsite.mjs`. The
resolution order is `$SPLATSITE_CLI`, the plugin's own `cli/`, a `splatsite` on `PATH`, then a
`splatsite/cli` above the working directory. Say which one you used, because a user with two
checkouts will otherwise wonder which image and template they got.

Reconstruction runs in Docker. The image is `ghcr.io/shamlikt/splatsite-recon:latest` by
default, `splatsite-recon:dev` for a local build, or whatever `SPLATSITE_IMAGE` names. A host
GPU is detected and used automatically.

## Quality levels

| Level | Method | Time | Needs | Output |
|---|---|---|---|---|
| `fast` | WorldMirror 2.0, feed-forward | 1-3 min on GPU, 10-30 min on CPU | anything | no spherical harmonics, `.sog` directly |
| `balanced` | WorldMirror 2.0, higher fidelity | a few minutes | GPU | carries SH bands |
| `high` | COLMAP poses + 30k-step gsplat training | 30-60 min | GPU | best quality, carries SH bands |

`fast` is the default, and `--quality` may be omitted. Pick `high` when the person asks for it
or when the capture itself is the point of the site; a `fast` scene on screen today is worth
more than a better one in an hour when the page's structure is still being decided, and the two
are interchangeable afterwards. A `high`
run on a CPU-only host is refused immediately rather than failing an hour in.

`--scale N` (20-100) reduces frame width and cuts time roughly with the square of the number.
`--frames N` overrides the frame count. Every stage is resumable: rerun the identical command
after an interruption and it skips what finished, using markers under `<out>/stages/`.

## Licensing, said plainly

`fast` and `balanced` route through Tencent HY-World 2.0, whose community license excludes the
European Union, the United Kingdom and South Korea from its territory. `high` uses only COLMAP
and gsplat, which carry standard open-source terms and no territory carve-out. If the person
is in one of those places, or the work is commercial and they have not read that license,
recommend `high` and say why in one sentence.

## The SOG finish step

A capture with spherical harmonics needs a GPU encoder to compress into `.sog`. A container
often has no usable Vulkan adapter even on a GPU host, so the container writes
`capture*.ply` plus an empty `sog-pending` marker and exits 0. That is deferral, not failure.
`splatsite convert` then runs the finish step on the host automatically. If the scene still has
a `sog-pending` marker afterwards, run `splatsite finish <scene>` on a machine with a GPU; a
built page needs `.sog`, and `splatsite build` and this skill's `stage-init.mjs` both refuse
while the marker is there.

## Judging a capture before designing anything

Run `node scripts/scene-plan.mjs <scene>`. It exits 2 on anything that would produce a blank or
broken page. Three findings matter most.

**The frame points away from the capture.** The walking direction is derived from where the
phone moved, not where it looked. Footage shot walking backwards, keeping a subject in frame,
produces poses facing empty space: the page reports itself live with millions of splats loaded
and renders nothing. The fix is to negate `frame.fwd` and `frame.right` in the scene's
`manifest.json` and rerun the planner. If a page ever comes back `live: true, count > 0,
coverage: 0`, this is the first thing to check.

**The walk is short relative to the capture.** A capture whose path is a small fraction of its
radius does not reward flying along it; build the page around orbits and held poses instead of
a long travel.

**Registration warnings on `high`.** The poses stage reports how many frames COLMAP registered.
Below 80% is a warning and below 50% is treated as failure, both meaning too little texture,
too much motion blur, or too fast a sweep. Reshoot advice worth giving verbatim: walk slowly,
keep the subject in frame, overlap each step heavily, avoid blank walls and mirrors, and shoot
a loop back to the start if the space allows it.

## Failures you will actually hit

**GPU memory guard refuses a stage.** On a unified-memory host, another process holding GPU
memory makes training thrash rather than fail. The stage refuses up front and names the other
GPU users. Stop them and rerun the same command; it resumes.

**`high` training dies in the first seconds with "No space left on device".** The full message
is `RuntimeError: unable to allocate shared memory (shm) for file </torch_…>: No space left on
device (28)`, and nothing is out of space: the device it names is `/dev/shm`, which Docker
gives a container 64 MB of by default. The trainer's dataloader hands decoded frames back from
its worker processes through shared memory, so a 1080p capture exhausts that within a few
steps. `convert` now passes `--shm-size 16g`, so this should not recur; a checkout older than
that fix needs `--shm-size` added to `dockerArgs()` in `cli/lib/docker.mjs`, or the same
`docker run` issued by hand with the flag. Only `high` is affected — `fast` and `balanced` are
feed-forward and use no dataloader workers, so a host where they both pass proves nothing about
this. Frames and poses are kept, so a rerun resumes straight into training.

**Root-owned scene files.** The container runs as root, so the output may not be yours.
`convert` detects this and prints the exact `chown` to run before building.

**Chromium missing for `check`.** `npx playwright install chromium` once. On a flaky network,
download the build another way and put it under `~/.cache/ms-playwright/`.

**`splatsite check` appears to hang.** It does not: under SwiftShader a multi-million-splat
capture takes two to three minutes to load, sort and paint. Run it in the background and read
the result when it lands. A run killed by a command timeout reports a closed page rather than a
timeout, which reads like a page error and is not one.

**A tier file is missing.** The scene's manifest names three tiers. If one is absent the page
falls back to the desktop tier on every device, which is a slow phone, not a broken page, but
say so rather than letting it pass silently.
