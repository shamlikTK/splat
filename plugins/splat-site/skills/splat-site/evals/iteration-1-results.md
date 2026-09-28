# Iteration 1 — 2026-09-11

Two fresh agents ran the skill end to end, one per route, on real converted scenes. No
without-skill baseline: the pipeline is not discoverable without the skill, so a baseline
measures only its absence.

| Eval | Route taken | Result |
|---|---|---|
| template-route-photo-walk | template (correct) | built 5 spots / 5 photos; check: live, 257856 splats, coverage 0.765, console clean |
| bespoke-scroll-page-from-scene | bespoke (correct) | 8 acts, 5 device families, signature move drawn from `project()`; check: live, 294000 splats, coverage 0.772, console clean |

Both routes were chosen correctly from the brief, which was the main thing being tested.

## Defects found and fixed in this iteration

1. Manifest doc path was wrong (`cli/docs/` → `splatsite/docs/`).
2. No way to derive `{t, a, h}` for a frame → bundled `scripts/frame-spots.mjs`, which projects
   each frame's camera onto the walk axis, spaces the selection and copies the frames.
3. Frame filenames are not in walk order; nothing said so → documented, and the new script sorts.
4. No guidance when the capture contradicts what the person said it was → Step 3 now requires
   saying so and writing copy from the pixels.
5. `splatsite check` outruns a default command timeout on software rendering → documented, and
   the skill now says to background it.
6. Step 6 read as bespoke-only → it now states that `check` alone verifies the template route.
7. A scene can be missing `manifest.json` while its stage marker claims done (older images wrote
   it inside the container) → the loader now prints the seconds-long recovery.
8. Stale poster filename in the pasted markup → corrected, with a note that the name varies.
9. Acts must be `data-sc-act="pin"`; this was only in source comments → now in the docs.
10. The screenshot harness loses its browser on a GPU-less host → added `?ss-tier=software`,
    `scripts/chrome-software.sh`, and `scripts/stage-probe.mjs`, a seconds-long check of the one
    thing that matters in 3D: whether the camera answers the scroll.

## Not covered

A real phone, a real GPU, and a completed scroll-craft contact sheet: the harness could not
finish a run on this host. `stage-probe.mjs` passed 8 of 8 positions with zero still steps.

# Iteration 2 — 2026-09-12, full end-to-end run

Ran the skill myself on a 25-second phone clip: convert, judge, brief, stage, page, verify.
Reconstruction took 6m26s on GPU for 2.94M splats. Final page: live, 294,000 splats, coverage
0.349, console clean; camera probe 10 of 10 positions moved; scroll-craft's harness walked 31
positions with no dead scroll and every cue clearing 4.5:1.

Defects found and fixed:

11. Derived poses looked the wrong way on captures shot walking backwards, where the walk's
    distance range runs against the viewing direction. Poses now aim along the direction the
    sanity check guarantees faces the capture, and the planner says which end is nearest.
12. A `position: fixed` scrim covers the viewport for the whole scroll, so every act's scrim
    stacked over every other act's copy. Measured: hero headline 75 of 255 before, 240 after.
    Hit-testing cannot find this, because scrims carry `pointer-events: none`.
13. `data-sc-kinetic` is read off the cue element itself, so a split headline inside a cued
    wrapper never splits.
14. The screenshot harness failed on its first screenshot every time, because a splat canvas
    never goes quiet. Added `?ss-still=1`, which pauses the renderer once the camera settles;
    the harness then completes a full walk.
15. Reading the contact sheet showed the peak aiming down the walk at bare ground. Aim a lift at
    the capture's centre, and expect canopy rather than ground on a tree-covered site, because a
    phone at head height records no aerial detail.

Environment facts confirmed: plugin skills register at session start, so a mid-session install
needs /reload-plugins before the scroll-craft handoff is invocable; the on-disk fallback works.
The container's pose derivation is older than the repo's fixed copy, so a fresh conversion can
still produce a backwards frame.

# Iteration 3 — 2026-09-13, the waypoint-walk grammar

Analysed `3d/builds/mmnj` and made its grammar the skill's default, with a runtime that can
build it. Rebuilt the test page in it and verified: check live with 294,000 splats and a clean
console, probe 9 of 9 positions moved, contact sheet read.

16. The grammar bans acts, which the stage drove from, so it gained track mode: `[data-ss-track]`
    with weighted legs, an auto-sized spacer, whole-track copy windows, `ss:waypoint`, and the
    capture's splat sample forwarded so the route map can be a plan of the real place.
17. scroll-craft's harness cannot verify this grammar: it samples inside acts, finds none, and
    reports "no dead scroll" after photographing one screen. `stage-probe.mjs --shots` now
    produces the walk and the contact sheet instead.
18. Self-inflicted and caught by reading the numbers: putting the leg index inside
    `data-sc-verify-state` made two identical camera positions look different, which would have
    hidden real stillness. The signature is camera-only again; the leg has its own attribute.
19. A 16-degree orbit spread across a whole leg is invisible in its middle, where the sweep is
    about one degree. Orbits need to be wide or the leg short.
