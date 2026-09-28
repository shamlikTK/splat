# Designing the page around a capture

scroll-craft decides what the page is. This file says what changes when one of its device
families is a real 3D capture, and what a splat scene is actually good for.

## The composition is a fixed world, not a stage per act

A scroll-craft page usually gives each act its own stage. A capture is one continuous place, so
it lives in a single fixed element behind the whole page and the acts become copy over it that
also move the camera. That is the same shape as worldflight, without the seam problem:
there are no clips to cross-fade, because the world is geometry and the camera simply moves.

What this changes in practice: the copy layer needs its own scrims, the acts hold copy rather
than imagery, and the page's ending has to resolve the camera somewhere deliberate rather than
just running out of sections.

## The capture counts as one device family

scroll-craft requires at least four families and forbids the same one twice in a row. A camera
move is one family however many acts it spans. A page that is nothing but the capture moving is
the failure the skill exists to prevent: five sections that behave identically are one section
shown five times.

So plan at least three non-splat acts. The ones that sit well against a 3D world:

- **flow / reveal** for the section that reads like a document, which every page needs once.
- **kinetic** type for the line that has to land, placed where the camera holds still.
- **pan** for a lateral rail of photographs taken at the places the camera has just walked past.
- **count** only if the brand has real verified numbers.
- **pointer** devices for the closing act, where the page stops moving and starts responding.

Two consecutive splat acts is the practical limit before something else has to happen.

## Act patterns that work

**Entrance.** `data-ss-move="gate>w2"` over a held headline. The camera moving under the
reader's own hand is the strongest open this format has, and it is the one thing a photograph
cannot do.

**Stand and turn.** `data-ss-move="w3" data-ss-orbit="16"`. The frame holds its position and
sweeps, so copy can be read while the world still moves. This is where kinetic type belongs.

**Lift.** `data-ss-move="w4>rise" data-ss-fov="60"`. Rising to see the whole place at once is
the move a visitor cannot make themselves, so it is usually the peak. Give it the largest span
on the page and make the act before it quieter.

Two warnings, both learned by shipping one. Aim the lift at the capture's centre, which is what
the derived `wide` pose does, rather than along the walk: a camera that rises while still
looking down the path frames bare ground, and a peak made of dirt is not a peak. And check what
is actually up there. A phone carried at head height records no aerial detail, so lifting over a
tree-covered site reveals canopy rather than the gathering underneath. When the capture has
nothing above it, make the peak a lateral move or a close approach instead, and say so rather
than spending the page's biggest act on a view the footage never contained.

**Approach.** `data-ss-move="w2" data-ss-push="0.4"` walks in toward one thing. Pair it with a
pin on that thing.

**Resolve.** `data-ss-move="close"` or back to `gate`. Returning to where the page started
reads as an ending; stopping mid-walk reads as the page having been cut off.

## Interaction, which is the actual reason to use 3D

A flythrough is a video with extra steps. What a capture gives you that a video cannot:

1. **Pins on real places.** A photo, a caption, a price, a name, anchored to the spot it
   belongs to and occluded correctly as the camera moves. Clicking one can fly there. Get the
   coordinates from `scripts/frame-spots.mjs`, which reads where each frame's camera stood and
   prints `{t, a, h}` you can paste straight into `data-ss-pin`; guessing them puts pins in
   walls.
2. **A waypoint rail.** List the stops as buttons; `SplatStage.flyTo` takes the camera and the
   next scroll gives it back. This is navigation the visitor controls, which pinned scroll
   alone never is.
3. **Pointer lean.** `data-ss-look="5 3"` on the stage gives a few degrees of parallax to the
   whole world. Small numbers. It should read as depth, not as a joystick.
4. **A signature move built from `project()`.** Drawing the page's own graphics over world
   points, a measurement line, a route trace, a label that sticks to a doorway, is bespoke to
   this site and costs a few lines, because the projection is already there.

Pick one of these as the site's signature move and build it properly rather than sprinkling
all four.

## Mobile and reduced motion

Phones get the mobile tier and a wider field of view automatically, but composition is still
art-directed separately: a pose framed for a wide desktop viewport crops badly in portrait, so
check each act at phone size and move the pose, not just the type.

Under reduced motion and on machines with no WebGL2 the capture is never fetched and the poster
is the page. Every act has to still say something in that state. Write the copy first and
check it reads with the world removed.

## When the template route is the better answer

The splatsite CLI already ships a finished photo-walk page: a fixed capture, pins holding
photos grouped by spot, an album, a route map, and a full-capture orbit viewer. If what the
person wants is "my photos, in the place I took them", build that with
`splatsite build <scene> --photos DIR --out site`, hand-editing the manifest's spots. It is one
command, it is already verified, and a bespoke page would spend a day arriving at the same
thing.

Choose the bespoke scroll-craft route when the site has to argue something: a brand, a
property, a product, a place being sold rather than remembered. Then the capture is the
evidence and the page is the argument, and the structure has to be designed.
