# The waypoint walk: the pattern every splat site follows

This is the structure the reference build arrived at, and it is the default for sites built with
this skill. It is a **grammar**, not a skin: it fixes what a section is, what the chrome is for,
how the visitor knows where they are, and how the page ends. Palette, copy, type and feeling
curve are still scroll-craft's to decide per brand.

Depart from it only when the brief actually demands something else, and when you do, say which
rule you broke and why. "It felt nicer" is not a reason.

## What it is

One live 3D place on one fixed stage. Scroll walks the camera along a single authored path.
The waypoints are the things worth stopping at, anchored as pins at real positions in the
capture. Copy lives in one fixed layer, windowed against the whole track. The only thing in
document flow is a spacer.

The camera **translates along a path**. It never circles a subject, never cuts, and never leaves
the capture.

## The seven rules

1. **No acts, no sections in flow.** The page is one track of legs between waypoints, not a
   stack of blocks. A block-built page has seams, and a world with seams is not a world.
2. **Nothing scrolls over the canvas.** Copy arrives inside the frame, at waypoints, in the
   fixed layer. No section slides up over the world.
3. **The nav is a route map**, not a bar: a plan of the place drawn from the capture itself, the
   path, a you-are-here dot with heading, and the pins as buttons that fly you there. The part
   already walked is drawn in the accent, so the map is also a record of where you have been.
   One quiet text link carries the single action.
4. **The hero is the place, already in view.** The camera is moving from the first notch, the
   title sits over the world as real markup, pins glow at depth. No wordmark bar, no scroll cue,
   no title card.
5. **The signature move is pin flight.** A pin is a real button anywhere on the page, including
   the far ones. Click it and the camera flies along the walk to it; on arrival the photo blooms
   out of the pin where it was taken; click again for full screen with previous and next. The
   map stamps it visited. The move and the peak are the same system, because the peak is where
   every pin lights at once.
6. **One leg is the rise, and it is the peak.** It gets the largest span by a visible margin, the
   widest view of the capture, the one second-person line on the page, and an authored silence
   in front of it so it has something to rise from. Adjacent legs never share a feeling.
7. **The close is arrival.** The camera settles at an overlook with every pin lit, the album is
   laid out in the fixed layer with one quiet colophon, and it holds. The page stops and stays
   complete rather than fading out.

## Bans

No `data-sc-act`. No section in document flow. No video. No orbit or turntable. No hard cuts.
No wordmark-plus-action bar. No full-frame scrim. Nothing that scrolls over the canvas. No
second stage.

## Free look at the stops, not free roaming

While the camera stands at a stop, the visitor can look around: drag, swipe sideways, or use the
arrow keys. Bound it to roughly 32 degrees either side and a little up and down, because a phone
capture is a forward wedge and wider angles show its edges. Scrolling on eases the view back to
the authored frame over about a third of a second. Between stops a drag is a scroll, not a look.
Show a one-line hint once per session at the first stop and drop it on the first look.

Full roaming is deliberately not offered: the capture has no good angles off its axis, and
letting someone walk into the void is worse than not letting them walk at all.

## The look

A dark ground, so the capture is the brightest thing on the screen. Bone type. **One accent that
belongs to the pins and the walked path and nothing else** — not to headings, not to buttons in
general. Grain at a few percent. Every photo carries the same caption schema, gallery-label
style; the variety on the page comes from the camera and from what shares the screen with it,
never from styling each photo differently.

## Pacing

Five or six legs. The peak leg runs about twice the length of an ordinary one. A three-photo
walk lands near nine viewport heights, and each added photo adds roughly one more. No leg holds
a still frame, and the total never lands in the band a previous build already occupies.

## What the harness needs from it

The stage publishes `data-sc-verify-state` carrying the camera, the current leg and the lit
pins, so the authored silence before the peak reads as anticipation rather than dead scroll.
Mark deliberate holds so a still camera is never mistaken for a broken one.
