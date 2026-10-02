# splat

Turn a phone video into a 3D Gaussian-splat capture, then into a website you walk through by
scrolling. One skill drives the whole thing: reconstruction runs in Docker, the page is designed
through [scroll-craft](https://github.com/nateherkai/scroll-craft).

## Install

```
/plugin marketplace add shamlikt/splat
/plugin install splat-site@splat
```

Then, in Claude Code:

```
/splat-site ~/videos/my-clip.mp4
```

## What you get

A scene folder holding the capture as three compressed tiers, the recovered camera path, and a
starter manifest. Then either the photo-walk page the CLI ships — your photos pinned at the spots
they were taken, with an album and a route map — or a bespoke scroll page designed around the
capture.

## Requirements

| | |
|---|---|
| Node | 22 or newer |
| Docker | required for reconstruction; a host GPU is detected and used automatically |
| GPU | required for `balanced` and `high`; `fast` also runs on CPU |
| Chromium | `npx playwright install chromium`, for the verification commands |

## Quality levels

`--quality` is optional and defaults to `fast`.

| Level | Method | Time | Needs |
|---|---|---|---|
| `fast` | WorldMirror 2.0, feed-forward | 1-3 min on GPU, 10-30 min on CPU | anything |
| `balanced` | WorldMirror 2.0 plus a short training run | a few minutes | GPU |
| `high` | COLMAP poses plus 30,000 gsplat training steps | 30-90 min | GPU |

Measured on an NVIDIA GB10: a 25-second clip at `fast` produced 2.94M gaussians in 6 minutes 26
seconds. A 35-second clip at `high`, 345 target frames at 70% scale, reached 32.9 dB in about 95
minutes.

Footage decides more than the level does. Sweep slowly so neighbouring frames differ by a few
degrees, favour textured surfaces, keep bright windows out of frame, and walk forward through a
space rather than backwards away from it. A fast sweep of a blank interior reconstructs as fog at
any quality level.

## Licence

This repository is MIT. The reconstruction methods are not all the same:

- **`fast` and `balanced` route through Tencent HY-World 2.0**, whose community licence
  **excludes the European Union, the United Kingdom and South Korea** from its territory. If you
  are in one of those places, those two levels are not licensed to you.
- **`high` uses only COLMAP (BSD) and gsplat (Apache 2.0)**, with no territory restriction.

Pick `high` if that carve-out is a problem for you. It is also the better reconstruction.

Rendering is [Spark](https://github.com/sparkjsdev/spark) and [three.js](https://threejs.org),
both MIT.

## Documentation

The manual is generated from the skill's own files, so it cannot drift from the skill it
documents: [shamlikt.github.io/splat/manual/](https://shamlikt.github.io/splat/manual/).

## Repository layout

```
plugins/splat-site/      the plugin: the skill, and the CLI it drives
  skills/splat-site/     SKILL.md, references, scripts, the stage runtime
  cli/                   the splatsite npm package
docker/                  the reconstruction image
site/                    the published pages
```
