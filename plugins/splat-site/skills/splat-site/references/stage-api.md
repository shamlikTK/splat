# The splat stage: a capture as a scroll-craft device

`assets/splat-stage.js` mounts a Gaussian-splat capture as one fixed world behind the page and
flies its camera from scroll-craft act progress. Acts stay ordinary scroll-craft acts; they
just also say where the camera should be.

## Install it

```bash
node <skill>/scripts/stage-init.mjs <scene-dir> --out <build-dir> [--stops 5]
```

Copies `vendor/` (three.js + Spark) and `splat.js` from the splatsite CLI template,
`splat-stage.js` and `splat-stage.css` from this skill, the capture tiers and posters into
`<build>/assets/`, and writes `<build>/scene.json`. It only writes those files, so it is safe
to rerun over a build in progress after a reconvert. It refuses on a scene whose frame faces
away from the capture, or one still waiting on SOG encoding.

## Wire the page

Order matters: the import map must precede the module, and the engine must be mounted.

```html
<link rel="stylesheet" href="scrollcraft.css">
<link rel="stylesheet" href="splat-stage.css">
<script type="importmap">{"imports":{"three":"./vendor/three.module.js","three/addons/":"./vendor/three-addons/","@sparkjsdev/spark":"./vendor/spark.module.js"}}</script>
...
<div class="ss-stage" id="stage" data-ss-stage="scene.json" data-sc-verify-state="" data-ss-look="5 3">
  <img class="ss-poster" src="assets/desktop.jpg" alt="What the visitor is looking at.">
  <canvas class="ss-canvas"></canvas>
</div>
...
<script src="scrollcraft.js"></script>
<script>ScrollCraft.mount(document.body);</script>
<script type="module" src="splat-stage.js"></script>
```

Use the poster path `stage-init.mjs` printed: a scene converted with posters gives you its own
JPEGs, and one converted without them gets a flat SVG placeholder instead, so the filename is
not fixed. `id="stage"` is what `splatsite check` looks for; without it that checker reports the page is
not a splat site at all. The stage element holds the poster and the canvas and nothing else:
copy goes in the acts or in a fixed copy layer above it, never inside the stage.

## Track mode: the waypoint walk

The grammar in [house-pattern.md](house-pattern.md) has no acts. Declare the walk as a track of
legs instead, and the stage sizes the page, drives the camera and grades the copy from it.

```html
<div data-ss-track hidden>
  <div data-ss-leg="gate>w3"   data-ss-w="1.3" data-ss-label="The gate"></div>
  <div data-ss-leg="w3>w2"     data-ss-w="1.2" data-ss-linger="0.3" data-ss-label="The long table"></div>
  <div data-ss-leg="w2>wide"   data-ss-w="2.4" data-ss-label="The rise"></div>
  <div data-ss-leg="wide>gate" data-ss-w="1.3" data-ss-linger="0.35" data-ss-label="The overlook"></div>
</div>
<div data-ss-spacer></div>

<div class="copy">
  <h1 data-ss-window="0 0.2 0 0.06">The place</h1>
</div>
```

| Attribute | Meaning |
|---|---|
| `data-ss-track` | holds the legs; it is metadata, so keep it out of the layout |
| `data-ss-leg` | a pose to hold, or `a>b` / `a>b>c` to fly across the leg |
| `data-ss-w` | the leg's weight in viewport heights (default 1.3) |
| `data-ss-linger` | 0 to 0.6, the last fraction of the leg spent standing at its end pose |
| `data-ss-label` | the waypoint's name, carried on the `ss:waypoint` event |
| `data-ss-fov`, `data-ss-orbit`, `data-ss-push` | as in act mode, per leg |
| `data-ss-spacer` | the only element in document flow; the stage sets its height |
| `data-ss-window` | `from to [rampIn rampOut]` in whole-track progress, for copy in the fixed layer |

The stage publishes `--ss-leg`, `--ss-legp` and `--ss-u` on the root element, mirrors the leg
index into `data-ss-leg` on the stage, and fires `ss:waypoint` when the leg changes, which is
what a route map listens to. The leg deliberately stays **out** of `data-sc-verify-state`: a
signature that changes when the leg changes makes two identical camera positions look different
and hides the very stillness the attribute exists to reveal. `SplatStage.on("sample")`
hands the page a strided sample of the capture's splats, so the map can be a plan of the real
place. A pin that has been flown to gets `is-visited`, so the map can record where the visitor
has been.

The spacer is sized at mount and again on load and once fonts settle, because a viewport height
read as zero at the wrong moment collapses the whole track to nothing with no error anywhere.

## Act attributes

The acts that drive the camera are ordinary scroll-craft acts, and in practice they are
`data-sc-act="pin"` sections: the world is already fixed, so the act's job is to hold its copy
still while the camera travels. `data-ss-move` on an element that is not an act still works,
falling back to the element's own geometry, but the engine then publishes no progress for it and
spans and dwell stop applying. Write them as pin acts.

| Attribute | Meaning |
|---|---|
| `data-ss-move="w2"` | hold the camera at pose `w2` for this act |
| `data-ss-move="gate>w3"` | fly from `gate` to `w3` across the act's progress |
| `data-ss-move="gate>w2>rise"` | fly through several poses, evenly across the act |
| `data-ss-fov="60"` | field of view in degrees for this act |
| `data-ss-orbit="16"` | degrees of yaw swept around the target across the act |
| `data-ss-push="0.35"` | dolly the eye this fraction of the way toward the target |
| `data-ss-ease="linear"` | constant rate instead of the default ease-in-out |

Pose names come from `scene-plan.mjs`: `gate`, `rise`, `close` and `wide` from the capture
itself, `w1..wN` spaced along the walk. An unknown name logs a warning naming the poses that do
exist, and the act is ignored rather than silently freezing the camera.

The camera reads `--sc-p` from the active act, so spans, dwell and any future engine pacing
change apply to the 3D camera automatically. When an act does not publish it, the stage falls
back to the act's own geometry, so a plain section still works.

## Pins

```html
<button data-ss-pin='{"t":0.42,"a":0.1,"h":0.15}' data-ss-fly="w3">The bench</button>
<button data-ss-pin='[1.2,-0.4,0.8]'>A world point</button>
```

`{t, a, h}` is the walk coordinate system: `t` along the path from 0 to 1, `a` across it, `h`
above the ground. Raw `[x, y, z]` works too. **Do not guess these numbers** — a guessed pin lands
in the trees rather than on the thing you meant. Get real ones from
`scripts/frame-spots.mjs <scene>`, which reads where each frame's camera stood and prints
coordinates you can paste straight in. The stage projects each pin every frame, sets
`--ss-x`, `--ss-y` and `--ss-z` on it and hides it when it is behind the camera or off frame.
Clicking dispatches a bubbling `ss:pin` event carrying the world point, and with `data-ss-fly`
it flies the camera to that pose until the visitor scrolls again.

Pins are the interaction this format is actually good at. A pin that opens a photo taken at
that spot, a caption, or a detail panel gives the visitor a reason to stop, which a flythrough
alone never does.

## JavaScript

```js
await SplatStage.ready;
SplatStage.pose("rise");                  // { eye, target }
SplatStage.resolve({ t: 0.5, a: 0, h: 0.2 });   // walk coordinates -> world
SplatStage.project([x, y, z]);            // world -> { x, y, z, visible } in CSS pixels
SplatStage.flyTo("w4", 2600);             // take the camera for 2.6s; scrolling returns it
SplatStage.on("paint", () => {});         // ready | paint | progress | pose
```

`flyTo` and `project` are what a signature move is built from: the page decides what to fly to
and what to draw over the world, and the stage stays a mechanism.

## What it handles so pages do not

**The dead-scroll check.** scroll-craft's harness reads `data-sc-verify-state`; a stage whose
only change is inside a WebGL canvas looks frozen without it. The stage writes a rounded
camera signature there every time the view changes. On an act that deliberately holds, add
`data-sc-verify-hold="true"` yourself so an authored stillness is not read as a fault.

**Reduced motion and machines with no WebGL2.** Neither fetches the capture. The poster stays,
pins are hidden, and `ss-poster-only` goes on the root element. Write the acts so they still
read as a page in that state, because for those visitors that is the page.

**A tier override for verification.** Load any page with `?ss-tier=software` (or `mobile`, or
`desktop`) to pin which capture it fetches. Use it for every harness run: a headless browser's
renderer string does not always admit it is software, and walking a multi-million-splat scene
through a screenshot harness will kill the tab with an opaque "target page has been closed"
error that looks like a page fault and is not one. `splatsite check` needs no override; it
detects the software renderer itself.

**Device tiers.** Software renderers get the lite capture, phones the mobile one, everything
else the full one, each with its own pixel-ratio cap. Rendering pauses when the stage scrolls
out of view.

**Camera smoothing.** Exponential, frame-rate independent, so scroll jitter does not reach the
picture and a 30Hz phone settles over the same wall-clock time as a 120Hz laptop.

## Gotchas

- **A scrim must be `position: absolute` inside the act's own stage, never `position: fixed`.**
  A fixed scrim covers the viewport for the entire scroll, so every act's scrim ends up stacked
  over every other act's copy, and z-index inside the acts will not save you. Measured on a real
  build: a hero headline rendered at 75 of 255 with three page-level fixed scrims over it and
  240 of 255 once they were scoped to their own acts. Worse, the usual way of hunting this
  (asking the browser what element is at that point) reports the text, because a scrim carries
  `pointer-events: none` and is skipped by hit-testing. Screenshot and measure the pixels.
- **`data-sc-kinetic` is read off the cue element itself.** A split headline inside a cued
  wrapper never splits; the engine reads the attribute from the element carrying
  `data-sc-cue`, so the cue and the split belong on the same tag.
- **Add `?ss-still=1` for any screenshot harness.** The renderer then stops as soon as the
  camera settles and restarts the instant it moves, so the frame on screen is still the right
  one. Without it, scroll-craft's `shoot.mjs` fails on its first screenshot against its own
  30-second timeout, every time; with it, a 31-position walk of a 2.94M-splat capture completes
  and reports normally.
- **Screenshots of a live capture are slow.** Under software rendering, one screenshot of a page
  with a painting splat canvas took tens of seconds and often exceeded a 60-second timeout, which
  is why a full screenshot harness struggles here and `stage-probe.mjs` exists. `splatsite check`
  copes because it takes exactly one, with a generous timeout.
- A scrim over the world must be a **sibling** of the copy, never a `::before` on it. The
  contrast pass hides text to photograph the background, and a pseudo-element of that text
  disappears with it, so the measurement grades the raw capture and never moves however much
  you strengthen the scrim.
- Captures are visually noisy in a way photographs are not. Copy needs a real scrim or a solid
  panel; thin light type directly over splats fails contrast at some scroll position even when
  it looks fine at the two you checked.
- Do not put `data-ss-move` on more than one act at the same scroll position. The stage picks
  the act straddling the middle of the viewport, so overlapping acts fight.
- The first pose in `scene.json` is where the camera starts before any act is active. Order
  `poses` so that is somewhere sensible, or open the page with an act at the top.
