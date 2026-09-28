---
name: splat-site
description: >
  Usage: /splat-site <video-or-scene> [fast(default)|balanced|high].
  Example: "/splat-site ~/videos/sports-day.mp4 fast — I walked the ground
  filming on my phone and took photos at a few spots along the way; photos are
  in ~/pictures/sports-day; I want visitors to walk the ground and find each
  photo pinned where I took it, with the whole set as an album underneath."
  Turn a phone video into a navigable 3D Gaussian-splat website: reconstruct the
  capture in Docker with the splatsite CLI, then always design the site through
  the scroll-craft skill (github.com/nateherkai/scroll-craft), which this skill
  requires rather than replaces. Use this whenever someone wants a
  video turned into 3D, a Gaussian splat, a .sog or .ply capture, a walkable or
  navigable 3D scene in the browser, a photogrammetry or radiance-field site, a
  virtual tour of a place they filmed, a "3D walkthrough", a scan of a room,
  shop, venue or property turned into a website, or hands over a scene folder
  from `splatsite convert` and wants a site around it. Also use it for "make my
  video 3D", "gaussian splatting website", "splat site", "3D scroll world from
  footage", or when a site's hero should be a real captured place rather than a
  video or a render.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Skill, AskUserQuestion
---

# splat-site

```
/splat-site <video-or-scene> [fast(default)|balanced|high]

/splat-site clip.mp4                 a scene and a site in minutes
/splat-site clip.mp4 high            trains for 30-60 min, best quality, GPU only
/splat-site ./scene balanced         a scene folder that already exists
```

## Invoked with no arguments

Print the usage block above and stop. Do not interview, do not ask which capture to use, do not
start work. A bare invocation is someone checking the form of the command, and the useful answer
is the form itself plus one line on what to include: the video or scene folder, the level if it
is not `fast`, and where the photos are if there are any. Then wait.

A phone video becomes a Gaussian-splat capture, and the capture becomes a website the visitor
scrolls through. Two halves, two different kinds of work: the first is a pipeline with known
failure modes, the second is design. This skill runs the first and hands the second to
scroll-craft with the 3D world already wired up as a device it can score.

**What you produce:** a scene folder (compressed capture tiers, camera poses, posters), a brief,
a built site whose fixed world is the real capture, evidence that it renders at desktop and
phone sizes and with motion reduced, and a plain account of what was not covered.

## What has to be in place

- **The splatsite CLI** (Node 22+). It may be on `PATH`; otherwise run
  `node <cli>/bin/splatsite.mjs`. The scripts here resolve it from `$SPLATSITE_CLI`, a
  `splatsite` on `PATH`, a `splatsite/cli` above the cwd, or `~/random/3dspacial/splatsite/cli`.
  Say which checkout you used.
- **Docker**, for reconstruction only. A host GPU is detected and used automatically. Without
  one, only `--quality fast` is possible.
- **The scroll-craft skill — required, not optional.** Every website this skill produces is
  built through scroll-craft: it owns the page's grammar, its feeling curve, its signature move,
  the fingerprint gate that stops builds repeating each other, and the taste floor. This skill
  owns the 3D and hands the page over. Never design the page yourself instead.
  - Source: <https://github.com/nateherkai/scroll-craft>, installed as the `nateherk-design`
    plugin (`/plugin marketplace add nateherkai/scroll-craft`, then install and enable it).
  - Invoke it by name: `scroll-craft`, or `nateherk-design:scroll-craft` under its plugin.
  - If the invocation fails with "unknown skill", the plugin is on disk but not registered in
    this session — plugin skills register at session start, so a mid-session install needs
    `/reload-plugins`. Then read its `SKILL.md` under `~/.claude/plugins/` and follow it by
    reading, which works identically, and tell the person to reload so the next run is native.
    Following it from disk is the fallback; skipping it is not.
  - Its scripts live beside that file, which is where the `<scroll-craft>` paths below point.
- **Chromium for Playwright** (`npx playwright install chromium`), for verification.

Read [references/pipeline.md](references/pipeline.md) before the first conversion.

## The quality argument

The invocation may name a level: `fast`, `balanced` or `high`, anywhere in the arguments
(`/splat-site my-clip.mp4 high`, or "build a site from this clip, balanced"). Take it as given
and use it for the whole run without asking again.

**When no level is named, use `fast`.** It is the only level that works on every host, it turns
a clip into a scene in minutes rather than an hour, and it gets a real page in front of the
person while there is still time to change the design. Say which level you used and what it
costs them, in one line, so the choice is visible rather than silent:

> Converting at `fast`, which takes a few minutes and is softer up close. Say the word and I
> will rerun it at `high`, which trains for 30 to 60 minutes and looks considerably better.

Upgrading later is cheap and nothing about the page depends on the level: reconvert into a new
scene folder, rerun `stage-init.mjs` against it, and the same markup renders the better capture.

## Step 1: One interview, not two

Gather everything in a single pass, then write it down. scroll-craft's own brief covers eight
topics and explicitly reuses answers already supplied, so asking its questions here and handing
it the file means the person is never interviewed twice.

Ask, in one message: what the video shows and what the place is; who the page is for and what
they must believe by the end; the one action the visitor should take; the scroll journey in
their own words, where it should feel calm and where intense, and the one moment they should
remember; how far from premium-minimal they want to go; what photos, footage, logo or palette
already exist; and whether anything about the capture is known to be awkward (low light, glass,
a subject they walked backwards away from).

Write the answers verbatim into `<workspace>/builds/<name>/BRIEF.md`, in their words. If the
person has delegated creative direction or is unreachable, author the brief and mark it as
authored rather than interviewed. Everything downstream reads from that file.

## Step 2: Reconstruct

```bash
splatsite convert <video> --out ./scene                       # fast by default
splatsite convert <video> --quality high --out ./scene        # add --image splatsite-recon:dev for a local build
```

Use the level the invocation named, or `fast` when it named none:

| Level | Time | Needs | Use when |
|---|---|---|---|
| `fast` (default) | 1-3 min on GPU, 10-30 min on CPU | anything | the default: a real scene today, and the only level a CPU-only host can run |
| `balanced` | a few minutes | GPU | a better feed-forward result without a full training run |
| `high` | 30-60 min | GPU | asked for, or the capture itself is the point of the site |

Start a `high` run in the background and do Step 1's writing and Step 4's planning while it runs;
every stage is resumable, so an interruption costs only the stage it was in. Two things to
mention once rather than discovering later: `fast` and `balanced` route through a model whose
licence excludes the EU, UK and South Korea, and a capture with spherical harmonics may come
back as PLY tiers plus a `sog-pending` marker that `splatsite finish <scene>` completes on a
GPU machine.

## Step 3: Judge the capture before designing anything

```bash
node <skill>/scripts/scene-plan.mjs ./scene
```

It prints the tiers, the splat count, the named camera poses a page can fly between, and it
exits 2 on anything that would produce a blank page. The failure worth knowing by name: when
the footage was shot walking backwards, the derived walking direction faces away from the
geometry, and the page loads millions of splats and renders nothing. The planner catches it and
names the fix. Do not design around a capture you have not planned; a bad capture is a reshoot,
not a styling problem, and the reshoot advice is in [references/pipeline.md](references/pipeline.md).

Look at the posters and a few frames under `scene/stages/images/` too, and **check that the
capture is what the person said it was**. Scene folders get reused, misnamed and handed over
second-hand, and a page written from the brief rather than from the pixels will confidently
describe a sports ground over footage of a market. If the capture and the request disagree, say
so before building, write copy that describes what is actually there, and flag the mismatch at
the top of the brief. Never paper over it with plausible copy.

The harness can tell you a capture rendered; only you can tell whether it is worth building a
site around.

## Step 4: Choose the route

**The template route.** The CLI already ships a finished photo-walk page: the capture as a
fixed world, pins holding photos at the spots they were taken, an album, a route map, an orbit
viewer. If the ask is "my photos, in the place I took them", fill in the manifest's `spots` and
build. Every manifest key is documented in `splatsite/docs/manifest.md` — note that is beside
`cli/`, not inside it.

Each spot needs a position in the walk's own `{t, a, h}` coordinates. Do not estimate them, and
do not assume frame numbers follow the walk: the extractor drops blurry frames and a phone's
path is not monotonic, so "every third file" scatters the pins. Derive them from where the
cameras actually stood:

```bash
node <skill>/scripts/frame-spots.mjs ./scene --count 5 --photos ./pics   # add --write to fill the manifest
splatsite build ./scene --photos ./pics --out ./site
```

`frame-spots.mjs` also copies the chosen frames into the photos folder, which is what to do when
the person has no separate photographs and wants stills from the capture itself. It writes
placeholder labels and captions on purpose: replace them with what the photo actually shows
before building, because placeholder captions are not a page.

That is the whole job. Do not rebuild it by hand. That page is itself a scroll-craft build — it
ships the same engine — so its copy, theme and structure still answer to scroll-craft's taste
floor, and anything beyond filling in spots and theme colours means taking the bespoke route
rather than hacking the template.

**The bespoke route.** When the page has to argue something, a property, a venue, a product, a
brand, the capture is evidence and the page is the argument, so the structure has to be
designed. Continue to Step 5.

Either way the page follows the **waypoint walk**, the grammar in
[references/house-pattern.md](references/house-pattern.md): one live place on one fixed stage,
scroll walking the camera along an authored path, waypoints anchored as pins, a route map for
nav, pin flight as the signature move, a rise for the peak, and arrival for the close. Read it
before planning anything. Depart from it only when the brief genuinely demands something else,
and then say which rule you broke and why.

Say which route you chose and why, in one sentence, before building.

## Step 5: Build the bespoke page

**Install the stage first**, so the design work has real poses to score against:

```bash
node <skill>/scripts/stage-init.mjs ./scene --out ./build --stops 5
```

This puts the renderer, the capture tiers, the posters and a `scene.json` of named poses into
the build, and prints the markup to paste. Full contract:
[references/stage-api.md](references/stage-api.md).

**Then invoke the scroll-craft skill** for the page itself. This is the step that makes the
result a page rather than a viewer with captions, and it is not optional: it carries the
grammar, the feeling curve, the fingerprint gate and the taste floor this skill deliberately
does not duplicate. Writing the markup yourself and calling it done is the one way to fail this
skill while appearing to finish it. Tell it, in the invocation:

- The brief is already written at `<path>/BRIEF.md`; do not re-interview.
- **The grammar is given, not chosen: the waypoint walk**, specified at
  `<skill>/references/house-pattern.md`. Read it first. It fixes the structure, the nav, the
  hero, the signature move, the peak and the close, and it carries hard bans: no acts, no
  sections in document flow, nothing scrolling over the canvas, no wordmark bar, no orbit, no
  cuts. What is still scroll-craft's to decide is everything that makes this build its own:
  palette, type, voice, the feeling curve, the copy, and what the waypoints are.
- The world is one fixed 3D capture behind the whole page. The camera is driven by the page's
  track; the device reference is at `<skill>/references/stage-api.md`.
- The peak is the rise, the leg that lifts to see the whole place at once, because that is the
  move a visitor cannot make themselves. Give it the largest span and an authored silence in
  front of it.
- Scrims must be siblings of the copy, never pseudo-elements, and `position: absolute` inside
  the act's own stage, never `position: fixed` across the page. Captures are noisier than
  photographs, so copy needs real protection.
- The engine reads `data-sc-kinetic` from the element carrying `data-sc-cue`, so a split
  headline needs both attributes on the same tag.

The grammar is in [references/house-pattern.md](references/house-pattern.md) and the camera
patterns, interaction ideas and traps are in
[references/page-recipes.md](references/page-recipes.md). Read both before scoring the page.

Theme with scroll-craft's tokens and pull the palette from the capture itself rather than
inventing one; the scene's own ground colour is in the manifest's theme.

## Step 6: Verify on the built page

For the template route, `splatsite check` is the whole verification: the page itself is already
tested in the CLI's own suite, so what needs proving is that this capture renders in it. For the
bespoke route both checkers matter, and they look at different things.

Run `splatsite check` in the background. Under software rendering a few million splats can take
two to three minutes to load, sort and paint, which is longer than a default command timeout;
killed mid-flight it reports an opaque closed-page error rather than a timeout.

```bash
splatsite check ./build --out check.png                       # does the world actually render?
node <skill>/scripts/stage-probe.mjs ./build --positions 10   # does the camera answer the scroll?
node <scroll-craft>/scripts/serve.mjs --root ./build --port 4500 &
node <scroll-craft>/scripts/shoot.mjs --url "http://localhost:4500/?ss-tier=software&ss-still=1" --out lab/shots
node <scroll-craft>/scripts/shoot.mjs --url "http://localhost:4500/?ss-tier=software&ss-still=1" --out lab/mobile --width 390 --height 844
node <scroll-craft>/scripts/shoot.mjs --url "http://localhost:4500/?ss-tier=software&ss-still=1" --out lab/reduced --reduced-motion
```

`splatsite check` loads the page under a software renderer and reports whether the stage went
live, how many splats loaded, how much of the frame they covered and whether the console was
clean. Coverage near zero with a nonzero count is the backwards-frame failure from Step 3, not
a rendering bug.

**For the waypoint walk, `stage-probe.mjs` is the verification, not a shortcut to it.**
scroll-craft's harness samples positions *inside acts*, and this grammar has none, so it
photographs the first screen and stops: it reports no dead scroll because it never walked. Run
the probe with `--shots lab/probe` instead, which screenshots every position and tiles a contact
sheet, and read that sheet. Still run `splatsite check` for the render proof.

```bash
node <skill>/scripts/stage-probe.mjs ./build --positions 10 --shots lab/probe
```

`stage-probe.mjs` asks only the 3D question and answers it in seconds: it reads the camera
signature the stage publishes at each scroll position and fails when too much of the page leaves
the camera where it was. Run it before the screenshot harness, because it finds the same dead
scroll far faster, and because on a busy or GPU-less host the full harness can lose its browser
mid-walk. If that happens, the run is an environment fault, not a page fault: rerun it alone,
and if the browser still dies, point it at `<skill>/scripts/chrome-software.sh` with
`SCROLLCRAFT_CHROME`, which forces the same software-WebGL flags `splatsite check` uses.

Both query parameters matter. `?ss-still=1` stops the renderer whenever the camera has settled,
which is the difference between a harness run that completes and one that dies on its first
screenshot: a canvas that never stops drawing never gives the harness the quiet frame it waits
for. `?ss-tier=software` keeps the fetched capture small, since a headless browser walking a
multi-million-splat scene can run out of room and close the page, which surfaces as an error
that reads like a page fault and is not one.

The scroll-craft harness walks each act and reports dead scroll, cues that never peak and
contrast measured on the composited page. The stage publishes its camera signature so a moving
world is not read as a frozen one; an act that deliberately holds needs
`data-sc-verify-hold="true"` from you.

If the screenshot harness cannot complete a run on this machine, say so plainly and do not
pretend the page was verified at every position. `splatsite check` plus `stage-probe.mjs` still
prove the world renders and answers the scroll; take a handful of screenshots yourself at chosen
scroll positions to look at composition, and name the mobile and reduced-motion passes as not
covered.

Then do the part neither covers: read the contact sheet, scroll the page cold and write one
word per act for what you felt, and diff that against the feeling curve in the brief. Where
they disagree the page is wrong, not the brief.

## Step 7: Hand it over

Report: which route you built, the capture's quality level and splat count, coverage and the
harness findings, where the scene folder and the build are, and the command to serve it. Then
say what a green run does not cover, because for this format the gaps are real: a physical
phone (headless Chrome cannot reproduce a phone's GPU memory limits with millions of splats), a
real GPU's appearance versus SwiftShader, and whether the page means anything.

## Working rules

- Long conversions run in the background; never sit and wait on a 40-minute training run when
  there is brief and score work to do.
- Never hand-edit a capture file. Edit the manifest, or reconvert.
- Keep the scene folder and the build separate: `stage-init.mjs` copies what the page needs, and
  a rebuild should never be able to destroy the reconstruction that took an hour. When a scene
  belongs to someone else, copy it into your workspace before editing its manifest.
- Only one headless browser run at a time on a software renderer; they starve each other.
- Quote real times and real numbers from the run, not estimates, once you have them.
