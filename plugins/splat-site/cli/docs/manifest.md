# The scene manifest

`manifest.json` is the one file that turns a raw capture (cameras + a Gaussian-splat file) into
a photo-walk website. `splatsite convert` writes a starter one — reconstructed frame, ground
plane and camera poses, `spots: []` — into the scene folder; you edit it to add the pins and
photos, then `splatsite build` reads it. This document lists every key, the coordinate system
spots and poses are written in, and a worked example. A real, complete generated starter
manifest (no spots edited in yet) is checked in at
[`splatsite/examples/manifest.sample.json`](../examples/manifest.sample.json) for reference.

## The `{t, a, h}` coordinate system

A capture has one walking direction — the path the phone followed. Rather than writing every
pin and camera position as raw `[x, y, z]` world coordinates (which depend on an arbitrary
reconstruction origin and scale), most positions in the manifest can instead be written as an
object `{ t, a, h }`:

- **`t`** — how far along the walk, `0` to `1`. `t: 0` is the near end of the captured path
  (`frame.fwd0`), `t: 1` is the far end (`frame.fwd1`). Values are allowed slightly outside
  `0..1` to stand a little before the start or past the end.
- **`a`** — across the walk, in the same units as the capture (typically meters). `0` is
  centered on the path; positive is to the right of the walking direction, negative to the left.
- **`h`** — height above the ground plane. `0` sits on the ground (`ground.point`), positive is
  up.

Picture the walk as a straight lane on the ground: `t` is how far down the lane you are, `a` is
how far you've stepped sideways off its centerline, and `h` is how far you've climbed above the
floor. Under the hood (`lib/manifest.mjs`, `resolve()`), this is converted to a world-space
point using the scene's `frame`:

```
world = frame.origin
      + frame.fwd   * lerp(frame.fwd0, frame.fwd1, t)
      + frame.right * a
      + frame.up    * h                          (measured from the ground plane)
```

Anywhere a `{t, a, h}` position is accepted, a raw `[x, y, z]` world-space array is also
accepted instead — `splatsite convert` writes the three built-in poses (`gate`, `rise`, `close`)
as raw arrays (derived directly from the reconstructed camera trajectory), while spot pins are
usually easier to place with `{t, a, h}` since you're thinking in terms of "partway down the
walk, a bit to the side, about knee height."

## Top-level keys

| Key | Type | Required | Meaning |
|---|---|---|---|
| `title` | string | yes | Page `<title>` and the page's short name used where no `mark`/`hero` override applies. |
| `description` | string | no (falls back to `title`) | `<meta name="description">`. |
| `mark` | string | no (falls back to `title`) | The small wordmark in the top-left navigation. |
| `hero` | `{ a, b }` | no (falls back to `{ a: title, b: "" }`) | The two-line hero headline (`a` normal weight, `b` bold/accent — see the worked example, `"My" / "capture"`). |
| `lede` | string | no | One-line subtitle under the hero. |
| `riseLine` | string | no | Caption shown at the "rise" pose (the overhead/overview stop on the walk). |
| `albumTitle` | string | no (default `"The album"`) | Heading above the photo grid. |
| `colophon` | string | no | Small footer credit line. |
| `morePages` | array of `{ href, label }` | no (default `[]`) | Links to other pages, for a site with multiple scenes — rendered as "Also walk: `label`, `label`." |
| `posters` | `{ desktop, mobile, alt }` | no | Paths (relative to the scene folder) to static poster images shown before the splat viewer loads. If omitted, or the files don't exist, `splatsite build` generates a flat-color SVG placeholder from `theme.ground` instead. `alt` is the shared alt text. |
| `capture` | string | **yes** | Path (relative to the scene folder) to the primary `.sog` capture file. Copied into the built site's `assets/` and referenced by the page config as `file`. |
| `photosDir` | string | no (default `"photos"`) | Folder name (inside the built site) that processed photos are written to. |
| `theme` | `{ accent, ink, ground }` | no (default `{}`) | Three colors (any CSS color, typically hex), written to `theme.css` as `--sc-accent` (the one accent color — pin highlights, links, the wordmark), `--sc-ink` (primary text) and `--sc-canvas` (the page background / placeholder poster color). Everything else in the visual system (secondary text, hairlines, etc.) derives from these automatically; there is no fourth theme key. |
| `frame` | object | **yes** | The scene's coordinate frame — see below. |
| `ground` | `{ point }` | no (falls back to `frame.origin`) | A point on the ground plane; the plane's normal is `frame.up`. `h` in `{t, a, h}` positions is measured from this plane. |
| `config` | object | no (default `{}`) | Walk/viewer tuning — see below. Merged over the walker's built-in defaults (`template/walk.js`'s `DEFAULTS`), so you only need to set what a particular capture requires. |
| `poses` | `{ gate, rise, close }` | **yes** | The three fixed camera poses that bracket the walk — see below. |
| `spots` | array | **yes** (may be empty while iterating, but a built site needs at least one to be interesting) | The pins and their photos — see below. |

### `frame`

The frame is the coordinate system every `{t, a, h}` position is resolved against. `splatsite
convert` derives it from the reconstructed camera trajectory, so you normally don't hand-edit
it, but it's worth understanding:

| Key | Type | Meaning |
|---|---|---|
| `up` | `[x, y, z]` | The ground normal (points away from the floor). Need not be `[0, 1, 0]` — it's whatever the reconstruction's "up" turned out to be. |
| `fwd` | `[x, y, z]` | The walking direction — the direction `t` increases along. |
| `right` | `[x, y, z]` | Optional; the sideways direction `a` increases along. If omitted, computed as `up × fwd`. |
| `origin` | `[x, y, z]` | The world point where `t = 0, a = 0, h = 0` (on the `fwd0` end of the path, before the ground-plane height offset). |
| `fwd0`, `fwd1` | number | The range of "distance along `fwd` from `origin`" that `t: 0` and `t: 1` map to. Usually `fwd0 = 0` and `fwd1` = the length of the reconstructed path. |

### `config`

Everything here tunes the walk's feel and the viewer's per-device behavior; all keys are
optional and merge over sensible defaults.

| Key | Meaning |
|---|---|
| `axis.back` | How far behind a spot's pin (along `fwd`, from a point on the walk axis) the camera's stopping point is computed from — keeps the stand-and-look camera from ever looking sideways across the capture. |
| `eyeHeight` | Height (above the ground plane) the walking camera stands at. |
| `standBack` | How far short of a pin the camera stops when it's not given an explicit `eye` (see "Single vs. multi-photo spots" below). |
| `legs.first`, `legs.photo`, `legs.rise`, `legs.afterRise`, `legs.close` | Relative scroll-distance weights for each leg of the walk (gate→first spot, spot→spot, last spot→rise, rise→next, →close). Bigger = more scroll to cover that leg. |
| `hold.photo`, `hold.rise` | Fraction of a leg spent motionless at its waypoint (a "beat" to look at the photo/overview) before moving on. |
| `fov.desktop`, `fov.mobile`, `fov.riseWiden` | Camera field of view in degrees, plus how many extra degrees the rise (overview) pose widens to. |
| `look.yaw`, `look.pitch` | Degrees of subtle pointer-driven camera lean (desktop, fine pointers only). |
| `freeLook.*` | Bounds and feel of the drag/swipe/arrow-key free look available at each stop (`yawMax`, `pitchMin`, `pitchMax`, `perPx`, `keyStep`, `easeBack`). |
| `desktop`, `mobile`, `software` | Per-device profiles: `{ file, lod, size, maxDpr }` — which `.sog` tier to load (a decimated tier for phones/software renderers keeps them fast), whether Spark builds a level-of-detail tree at load, a splat-count multiplier, and the device-pixel-ratio cap. `splatsite convert` fills these in with the capture's three tiers (full/mobile/lite). |
| `full` | The full-resolution `.sog` file, used as the default for `config.viewer.file` if that isn't set separately. |
| `viewer.file`, `viewer.fileMobile`, `viewer.fileLite`, `viewer.lod`, `viewer.size` | Same idea as `desktop`/`mobile`/`software`, but for the standalone "Full capture" orbit viewer (opened from the chrome), which starts from the `rise` pose and lets the visitor freely orbit the whole scan. |

### `poses`

Three named camera poses, each `{ eye, target }` (both accept `{t, a, h}` or raw `[x, y, z]`):

- **`gate`** — the opening view: where the walk starts, looking down the captured path.
- **`rise`** — the overview: the camera lifts up to show the whole ground at once (this is also
  where the standalone orbit viewer starts from).
- **`close`** — the closing view at the end of the walk.

### `spots`

Each entry is one pin on the ground with one or more photos taken standing at that pin:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `label` | string | yes | The spot's name (shown as a pin tooltip, and as the spot heading for multi-photo spots). |
| `pin` | `{t, a, h}` or `[x, y, z]` | yes | Where the pin sits on the ground. |
| `eye` | `{t, a, h}` or `[x, y, z]` | no | Where the camera stands to look at this pin. If omitted, it's computed automatically: back along the capture axis from the pin by `config.axis.back`, then in from there by `config.standBack`, at `config.eyeHeight` above the ground — i.e. leave it out unless the automatic stand-and-look position needs overriding (an obstruction, an odd angle). |
| `photos` | array, non-empty | yes | The photos taken at this spot — see below. |

Each photo is `{ file, title, alt }`:

- `file` — filename (not a path) of the photo, resolved against the `--photos` directory
  passed to `splatsite build`; it must exist there (`splatsite build` refuses with a clear error
  naming the missing file otherwise).
- `title` — caption shown under the thumbnail (and, for a single-photo spot, next to the pin
  label).
- `alt` — alt text for the image. Optional; falls back to `title` if omitted.

`w`/`h` (pixel dimensions) are written automatically by `splatsite build` after it resizes the
photo — don't set them by hand.

#### Single vs. multi-photo spots

A spot with exactly one photo renders differently from one with several:

- **Single-photo spot**: the album entry shows just that one photo, captioned with its title
  *and* the spot's label together (`<title> <spot label>`) — there's no separate spot heading,
  since the photo *is* the spot.
- **Multi-photo spot**: the album entry shows a spot heading (the `label`, linking to the first
  photo) with a photo count, then each photo captioned with just its own title underneath.

Use a multi-photo spot when several photos were taken standing in roughly the same place (e.g.
looking different directions, or a detail shot next to a wide shot); use separate single-photo
spots when each photo belongs at a different point along the walk.

## Worked example

This is the manifest from a real end-to-end run (`splatsite convert` on a 25 s portrait phone
clip at `--quality fast`, then two spots added by hand from frames pulled out of
`stages/images/`):

```json
{
  "title": "My capture",
  "description": "A walk through a 3D capture.",
  "mark": "My capture",
  "hero": { "a": "My", "b": "capture" },
  "lede": "Scroll to walk. Click a pin to open its photos.",
  "riseLine": "From up here you can see every spot.",
  "albumTitle": "The album",
  "colophon": "Built with splatsite.",
  "morePages": [],
  "posters": {
    "desktop": "posters/desktop.jpg",
    "mobile": "posters/mobile.jpg",
    "alt": "The capture from its entrance."
  },
  "capture": "capture.sog",
  "photosDir": "photos",
  "theme": { "accent": "#FF5B3A", "ink": "#F3EEE4", "ground": "#0A0F0C" },
  "frame": {
    "up": [-0.016832, -0.994439, 0.103961],
    "fwd": [-0.139066, 0.105294, 0.984669],
    "right": [-0.99014, 0.002116, -0.140065],
    "origin": [0.000126, 0.000002, 0.000043],
    "fwd0": 0.0,
    "fwd1": 1.2827491213046824
  },
  "ground": { "point": [0.000126, 0.000002, 0.000043] },
  "config": {
    "axis": { "back": 0.1924 },
    "eyeHeight": 0.1026,
    "standBack": 0.1283,
    "legs": { "first": 1.3, "photo": 1.0, "rise": 2.4, "afterRise": 1.3, "close": 1.3 },
    "desktop": { "file": "capture.sog", "lod": false, "maxDpr": 1.5 },
    "mobile": { "file": "capture-mobile.sog", "lod": false, "maxDpr": 1.25 },
    "software": { "file": "capture-lite.sog", "lod": false, "maxDpr": 1 },
    "full": "capture.sog",
    "viewer": {
      "file": "capture.sog", "fileMobile": "capture-mobile.sog", "fileLite": "capture-lite.sog",
      "lod": false, "size": 1.0
    }
  },
  "poses": {
    "gate": { "eye": [-0.0016, -0.102, 0.0107], "target": [-0.0462, -0.0683, 0.3265] },
    "rise": { "eye": [-0.116, -1.5236, 0.7979], "target": [-0.0891, 0.0675, 0.6316] },
    "close": { "eye": [-0.1951, -0.8594, 1.3671], "target": [-0.0746, -0.1449, 0.5261] }
  },
  "spots": [
    {
      "label": "Near the gate",
      "pin": { "t": 0.3, "a": 0, "h": 0.1 },
      "photos": [
        { "file": "spot1.jpg", "title": "Looking down the walk",
          "alt": "A phone-camera view down the captured walk, taken near the entrance." }
      ]
    },
    {
      "label": "Further along",
      "pin": { "t": 0.7, "a": 0, "h": 0.1 },
      "photos": [
        { "file": "spot2.jpg", "title": "Deeper into the capture",
          "alt": "A phone-camera view further along the captured walk." }
      ]
    }
  ]
}
```

The two spots use `{t, a, h}` at `t: 0.3` and `t: 0.7` (roughly a third and two-thirds of the
way down the walk), centered (`a: 0`) and just above the ground (`h: 0.1`) — both single-photo
spots, so each renders as one photo captioned with its title and spot label together. The three
built-in poses are shown here as raw `[x, y, z]` world-space arrays, exactly as `splatsite
convert`'s starter manifest emits them — `{t, a, h}` objects are accepted too (and are often
easier to hand-edit, since you're thinking in terms of "partway down the walk" rather than raw
coordinates); see the note below for why this particular capture's poses were hand-edited.

> **Note on this particular capture:** `splatsite convert`'s starter manifest for this clip
> initially wrote `frame.fwd`/`frame.right` and the three `poses` pointing *away* from the
> reconstructed content, not into it — the phone was walking backwards (away from the subject,
> keeping it in frame) rather than forwards, and the auto-derived frame followed the direction
> the camera physically moved rather than the direction it looked. That produced a page that
> reported itself "live" with splats loaded, but rendered nothing (`splatsite check` returned
> `coverage: 0`). The fix, shown above: negate `frame.fwd` and `frame.right` (`up` and `origin`
> are unaffected — only the walking-direction axis was backwards), and recompute `poses.gate` /
> `poses.rise` / `poses.close` against the corrected frame — easiest by thinking in `{t, a, h}`
> terms first, then writing out the raw `[x, y, z]` arrays shown above, rather than trying to
> hand-fix the old raw arrays in place. If your own `splatsite check` comes back with
> `live: true` and a nonzero `count` but `coverage: 0` (a "loaded but invisible" scene), suspect
> exactly this — check whether `frame.fwd`, from `frame.origin`, points toward or away from
> `bounds.json`'s `center` (in the scene folder) before assuming something else is wrong.
