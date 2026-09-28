/* ============================================================================
   splat-stage.js — a Gaussian-splat capture as a scroll-craft device.

   scroll-craft's engine drives DOM from scroll and publishes `--sc-p` (0..1) on
   every act. This module reads that same progress and flies a real 3D camera
   through a capture with it, so a splat scene becomes one device family in a
   scroll score rather than a separate page. It also projects DOM pins onto
   world points, which is the interaction the format is actually good at.

   Markup contract
     <div data-ss-stage="scene.json" data-sc-verify-state="">
       <img class="ss-poster" src="assets/poster.jpg" alt="...">
       <canvas class="ss-canvas"></canvas>
     </div>

     <section data-sc-act="pin" data-sc-span="3" data-ss-move="gate>w2">…</section>
     <section data-sc-act="pin" data-sc-span="2" data-ss-move="w2" data-ss-orbit="14">…</section>
     <button data-ss-pin='{"t":0.42,"a":0.1,"h":0.15}' data-ss-fly="w3">The bench</button>

   Act attributes
     data-ss-move   pose name, or "a>b" / "a>b>c" to fly across the act's progress
     data-ss-fov    degrees for this act (default: the scene's per-device fov)
     data-ss-orbit  degrees of yaw swept around the target across the act
     data-ss-push   0..1, how far the eye dollies toward the target across the act
     data-ss-ease   "inout" (default) | "linear"

   Pin attributes
     data-ss-pin    [x,y,z] world point, or {"t":…, "a":…, "h":…} walk coordinates
     data-ss-fly    pose name to fly to on click (scroll returns control)

   Public API (window.SplatStage)
     ready -> Promise, splat, scene, pose(name), resolve(pos), project(world),
     flyTo(nameOrPose, ms), on(event, fn)   events: ready | paint | progress | pose

   Why the camera is smoothed and why the stage publishes a verify signature:
   raw scroll is jittery at 120Hz and a stage whose pixels change only inside a
   WebGL canvas is invisible to scroll-craft's dead-scroll check, which reads
   `data-sc-verify-state`. Both are handled here so pages don't re-solve them.
   ========================================================================== */
import "./splat.js";

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => clamp(x, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const v = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};
const num = (el, name, dflt) => { const raw = el.getAttribute(name); const n = raw == null ? NaN : parseFloat(raw); return Number.isFinite(n) ? n : dflt; };

const listeners = { ready: [], paint: [], progress: [], pose: [] };
const emit = (name, value) => listeners[name] && listeners[name].forEach((fn) => { try { fn(value); } catch (e) { console.warn("[splat-stage]", e); } });

const API = {
  ready: null, splat: null, scene: null, mode: "live",
  on(name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); return API; },
};
window.SplatStage = API;

API.ready = boot().catch((err) => { console.error("[splat-stage]", err); return null; });

async function boot() {
  const stage = document.querySelector("[data-ss-stage]");
  if (!stage) return null;
  const src = stage.getAttribute("data-ss-stage") || "scene.json";
  const scene = await fetch(src).then((r) => { if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`); return r.json(); });
  API.scene = scene;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const probe = window.VenueSplat.probe();
  const small = () => matchMedia("(max-width: 860px)").matches || matchMedia("(hover: none) and (pointer: coarse)").matches;

  /* Poster route: reduced motion and machines with no WebGL2 never fetch the
     capture (it is the heaviest asset on the page and the scroll story has to
     read without it). Pins are hidden because there is no camera to project
     them through — the copy has to carry the section on its own. */
  if (reduce || !probe.supported) {
    API.mode = reduce ? "reduced" : "no-webgl";
    stage.dataset.ssMode = API.mode;
    stage.setAttribute("data-sc-verify-state", `poster:${API.mode}`);
    stage.setAttribute("data-sc-verify-hold", "true");
    document.documentElement.classList.add("ss-poster-only");
    window.MMNJ_WALK = { splat: () => null };
    emit("ready", null);
    return null;
  }

  /* Verification runs need a tier they can survive: a headless browser's renderer string does
     not always admit it is software, and a few million splats will take the tab out. Any page
     can be loaded with ?ss-tier=software (or mobile/desktop) to pin the capture it fetches. */
  const params = new URLSearchParams(location.search);
  /* Screenshot harnesses wait for the compositor to go quiet, and a splat canvas that keeps
     drawing never does: one screenshot then runs past a 30-second timeout and the whole walk
     fails. With ?ss-still=1 the renderer stops as soon as the camera has settled and starts
     again the moment it moves, so the frame on screen is still the right one. */
  const still = params.get("ss-still") === "1";
  const forced = params.get("ss-tier");
  const tier = ["desktop", "mobile", "software"].includes(forced) ? forced : probe.software ? "software" : small() ? "mobile" : "desktop";
  const prof = scene.tiers[tier] || scene.tiers.desktop;
  const canvas = stage.querySelector("canvas") || stage.appendChild(document.createElement("canvas"));
  canvas.classList.add("ss-canvas");
  canvas.setAttribute("aria-hidden", "true");

  const baseFov = () => (small() ? scene.fov?.mobile ?? 62 : scene.fov?.desktop ?? 52);
  const first = poseOf(scene.poses[Object.keys(scene.poses)[0]]);
  const splat = window.VenueSplat.create(canvas, {
    up: scene.up, eye: first.eye, target: first.target, fov: baseFov(),
    lod: !!prof.lod, maxDpr: prof.maxDpr || 1.5, size: prof.size || 1,
  });
  if (!splat) { stage.dataset.ssMode = "no-webgl"; document.documentElement.classList.add("ss-poster-only"); return null; }
  API.splat = splat;
  API.mode = tier;
  /* `splatsite check` (the CLI's coverage smoke test) reads #stage.is-live and
     window.MMNJ_WALK.splat() — the contract its own template publishes. Publishing
     it here means one verified checker covers both the template route and bespoke
     scroll-craft pages, instead of a second half-tested one. */
  window.MMNJ_WALK = { splat: () => splat };
  stage.dataset.ssMode = tier;
  stage.dataset.ssState = "loading";

  splat.on("progress", (p) => emit("progress", p));
  /* The route map is drawn from the capture's own splats, so the page needs a sample of them:
     32-byte rows of position, scale, colour and rotation. This is what makes the nav a plan of
     the real place rather than a diagram someone drew. */
  splat.on("sample", (bytes) => emit("sample", bytes));
  splat.on("ready", (count) => emit("ready", count));
  splat.on("paint", () => { stage.dataset.ssState = "live"; stage.classList.add("is-live"); emit("paint", true); });
  splat.load(prof.file).catch((err) => {
    console.error("[splat-stage] capture failed to load", err);
    stage.dataset.ssState = "failed";
    document.documentElement.classList.add("ss-poster-only");
  });

  /* Only render while the stage is on screen. A fixed stage usually always is,
     but a page that scrolls past it into a long album should not keep a sorter
     busy behind it. */
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((rows) => rows.forEach((r) => splat.pause(!r.isIntersecting)), { threshold: 0 }).observe(stage);
  }

  const acts = readActs();
  const track = readTrack();
  const windows = track ? [...document.querySelectorAll("[data-ss-window]")] : [];
  const pins = readPins(stage);
  const look = (stage.getAttribute("data-ss-look") || "").split(/\s+/).map(parseFloat);
  const lean = { yaw: Number.isFinite(look[0]) ? look[0] : 0, pitch: Number.isFinite(look[1]) ? look[1] : 0, x: 0, y: 0 };
  if (lean.yaw || lean.pitch) {
    if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
      addEventListener("pointermove", (e) => { lean.x = (e.clientX / innerWidth - 0.5) * 2; lean.y = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
    }
  }

  let shown = { eye: first.eye.slice(), target: first.target.slice(), fov: baseFov() };
  let override = null;               // a flyTo in progress
  addEventListener("wheel", () => { override = null; }, { passive: true });
  addEventListener("touchmove", () => { override = null; }, { passive: true });
  addEventListener("keydown", (e) => { if (/^(Page|Arrow| )/.test(e.key)) override = null; });

  let lastSig = "", lastT = performance.now(), quietAt = 0, sleeping = false;
  requestAnimationFrame(function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    const want = override && now < override.until ? override.pose : wantedPose();
    /* Exponential smoothing, not a fixed lerp: frame-rate independent, so a
       120Hz laptop and a 30Hz phone settle over the same wall-clock time. */
    const k = 1 - Math.exp(-dt / 0.11);
    shown = {
      eye: mix3(shown.eye, want.eye, k),
      target: mix3(shown.target, want.target, k),
      fov: lerp(shown.fov, want.fov, k),
    };
    const applied = applyLean(shown);
    splat.set({ eye: applied.eye, target: applied.target, fov: applied.fov });
    placePins(applied);
    /* The dead-scroll check reads this attribute: without it a stage whose only
       change is inside a canvas looks frozen to the harness. Rounded, so a
       still camera reports a still stage and an authored hold stays honest. */
    const sig = applied.eye.map((n) => n.toFixed(2)).join(",") + "|" + applied.target.map((n) => n.toFixed(2)).join(",") + "|" + applied.fov.toFixed(1);
    if (sig !== lastSig) {
      lastSig = sig; stage.setAttribute("data-sc-verify-state", sig);
      emit("pose", { eye: applied.eye, target: applied.target, fov: applied.fov });
      quietAt = now;
      if (still && sleeping) { sleeping = false; splat.pause(false); }
    } else if (still && !sleeping && now - quietAt > 600) {
      sleeping = true; splat.pause(true);
    }
  });

  /* ---- what the scroll position asks for ------------------------------- */
  function wantedPose() {
    if (track) return alongTrack();
    const act = activeAct();
    if (!act) return { ...poseOf(scene.poses[Object.keys(scene.poses)[0]]), fov: baseFov() };
    const p = progressOf(act);
    let pose = alongLegs(act.legs, act.ease === "linear" ? p : easeInOut(p));
    if (act.orbit) pose = orbit(pose, act.orbit * (p - 0.5));
    if (act.push) pose = push(pose, act.push * p);
    return { eye: pose.eye, target: pose.target, fov: act.fov || baseFov() };
  }

  /* The waypoint-walk grammar has no acts: the page is one track of legs between waypoints and
     the only thing in document flow is a spacer. Legs carry weights, so the spacer's height is
     (sum of weights + 1) viewport heights, and scroll position across the whole track picks the
     leg and the progress within it. */
  function readTrack() {
    const el = document.querySelector("[data-ss-track]");
    if (!el) return null;
    const legs = [...el.querySelectorAll("[data-ss-leg]")].map((leg) => ({
      el: leg,
      poses: leg.getAttribute("data-ss-leg").split(">").map((n) => n.trim()).filter((n) => scene.poses[n]),
      w: Math.max(0.2, num(leg, "data-ss-w", 1.3)),
      linger: clamp(num(leg, "data-ss-linger", 0), 0, 0.6),
      fov: num(leg, "data-ss-fov", 0),
      orbit: num(leg, "data-ss-orbit", 0),
      push: num(leg, "data-ss-push", 0),
      label: leg.getAttribute("data-ss-label") || "",
    })).filter((l) => l.poses.length);
    if (!legs.length) return null;
    let at = 0;
    for (const leg of legs) { leg.from = at; at += leg.w; }
    const t = { legs, total: at, spacer: document.querySelector("[data-ss-spacer]") || document.body.appendChild(document.createElement("div")), index: -1 };
    t.spacer.setAttribute("data-ss-spacer", "");
    const size = () => { t.spacer.style.height = ((t.total + 1) * (innerHeight || 800)) + "px"; };
    size();
    /* Sized once at mount, a viewport height of 0 silently collapses the whole track to nothing
       and the page looks static with no error anywhere. Resize again when the page has really
       settled. */
    addEventListener("resize", size, { passive: true });
    addEventListener("load", size);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(size);
    return t;
  }

  function alongTrack() {
    const span = Math.max(1, (track.spacer.offsetHeight || 0) - innerHeight);
    const u = clamp01(scrollY / span) * track.total;
    let leg = track.legs[track.legs.length - 1];
    for (const l of track.legs) if (u < l.from + l.w) { leg = l; break; }
    const local = clamp01((u - leg.from) / leg.w);
    // The last `linger` of a leg is spent standing at its end pose: a beat to look, which is
    // what makes a waypoint a stop rather than a place the camera passed through.
    const travel = clamp01(local / Math.max(1e-6, 1 - leg.linger));
    let pose = alongLegs(leg.poses, easeInOut(travel));
    if (leg.orbit) pose = orbit(pose, leg.orbit * (travel - 0.5));
    if (leg.push) pose = push(pose, leg.push * travel);
    const i = track.legs.indexOf(leg);
    if (i !== track.index) {
      track.index = i;
      stage.dispatchEvent(new CustomEvent("ss:waypoint", { bubbles: true, detail: { index: i, count: track.legs.length, label: leg.label, progress: local } }));
    }
    const root = document.documentElement.style;
    stage.setAttribute("data-ss-leg", String(i));
      root.setProperty("--ss-leg", String(i));
    root.setProperty("--ss-legp", local.toFixed(4));
    root.setProperty("--ss-u", (u / track.total).toFixed(4));
    gradeWindows(u / track.total);
    return { eye: pose.eye, target: pose.target, fov: leg.fov || baseFov() };
  }

  /* Copy in this grammar lives in one fixed layer and is windowed against the WHOLE track, not
     against a section, because there are no sections to belong to. */
  function gradeWindows(u) {
    for (const el of windows) {
      const v = (el.getAttribute("data-ss-window") || "").split(/\s+/).map(parseFloat);
      const from = v[0] || 0, to = Number.isFinite(v[1]) ? v[1] : 1;
      const rIn = Number.isFinite(v[2]) ? v[2] : (to - from) * 0.3;
      const rOut = Number.isFinite(v[3]) ? v[3] : (to - from) * 0.3;
      let o = 0;
      if (u >= from && u <= to) o = Math.min(rIn > 0 ? (u - from) / rIn : 1, rOut > 0 ? (to - u) / rOut : 1, 1);
      o = clamp01(o);
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translateY(${((1 - o) * 2.2).toFixed(2)}vh)`;   // capped: copy drifts, it does not fly
      el.style.pointerEvents = o > 0.5 ? "auto" : "none";
    }
  }

  function activeAct() {
    let best = null, bestD = Infinity;
    const mid = innerHeight / 2;
    for (const act of acts) {
      const r = act.el.getBoundingClientRect();
      if (r.top <= mid && r.bottom >= mid) return act;       // straddles the viewport middle
      const d = r.top > mid ? r.top - mid : mid - r.bottom;
      if (d < bestD) { bestD = d; best = act; }
    }
    return best;
  }

  /* Prefer the engine's own published progress so dwell remapping, spans and
     any future pacing change stay in one place; fall back to geometry when the
     act is not one the engine drives (a plain section used as a stage cue). */
  function progressOf(act) {
    const raw = parseFloat(getComputedStyle(act.el).getPropertyValue("--sc-p"));
    if (Number.isFinite(raw)) return clamp01(raw);
    const r = act.el.getBoundingClientRect();
    return clamp01(-r.top / Math.max(1, r.height - innerHeight));
  }

  function alongLegs(legs, t) {
    if (legs.length === 1) return poseOf(scene.poses[legs[0]]);
    const n = legs.length - 1, x = clamp01(t) * n, i = Math.min(n - 1, Math.floor(x)), u = x - i;
    const a = poseOf(scene.poses[legs[i]]), b = poseOf(scene.poses[legs[i + 1]]);
    return { eye: mix3(a.eye, b.eye, u), target: mix3(a.target, b.target, u) };
  }

  function orbit(pose, deg) {
    const up = v.norm(scene.up), rad = (deg * Math.PI) / 180;
    const arm = v.sub(pose.eye, pose.target);
    const along = v.scale(up, v.dot(arm, up));
    const flat = v.sub(arm, along);
    const side = v.cross(up, flat);
    const turned = v.add(v.scale(flat, Math.cos(rad)), v.scale(side, Math.sin(rad)));
    return { eye: v.add(pose.target, v.add(turned, along)), target: pose.target };
  }

  function push(pose, amount) {
    return { eye: mix3(pose.eye, pose.target, clamp(amount, -0.9, 0.9)), target: pose.target };
  }

  function applyLean(pose) {
    if (!lean.yaw && !lean.pitch) return pose;
    const turned = orbit(pose, -lean.x * lean.yaw);
    const up = v.norm(scene.up);
    const rise = v.scale(up, -lean.y * lean.pitch * 0.01 * v.len(v.sub(pose.eye, pose.target)));
    return { eye: v.add(turned.eye, rise), target: pose.target, fov: pose.fov };
  }

  /* ---- pins ------------------------------------------------------------- */
  function placePins(pose) {
    if (!pins.length) return;
    const r = canvas.getBoundingClientRect();
    for (const pin of pins) {
      const s = splat.project(pin.world);
      const on = s.visible && s.z > 0;
      pin.el.hidden = !on;
      if (!on) continue;
      pin.el.style.setProperty("--ss-x", (r.left + s.x).toFixed(1) + "px");
      pin.el.style.setProperty("--ss-y", (r.top + s.y).toFixed(1) + "px");
      pin.el.style.setProperty("--ss-z", s.z.toFixed(2));
    }
  }

  function readPins(stage) {
    return [...document.querySelectorAll("[data-ss-pin]")].map((el) => {
      const world = API.resolve(JSON.parse(el.getAttribute("data-ss-pin")));
      el.classList.add("ss-pin", "pin");   // "pin" is the class `splatsite check` counts
      const to = el.getAttribute("data-ss-fly");
      el.addEventListener("click", () => {
        el.dispatchEvent(new CustomEvent("ss:pin", { bubbles: true, detail: { world, pose: to } }));
        if (to && scene.poses[to]) API.flyTo(to, num(el, "data-ss-fly-ms", 2600));
        el.classList.add("is-visited");   // the route map reads this: the map is also a record
      });
      return { el, world };
    });
  }

  function readActs() {
    return [...document.querySelectorAll("[data-ss-move]")].map((el) => {
      const legs = el.getAttribute("data-ss-move").split(">").map((s) => s.trim()).filter(Boolean);
      const missing = legs.filter((n) => !scene.poses[n]);
      if (missing.length) console.warn(`[splat-stage] unknown pose(s) ${missing.join(", ")} — scene.json has: ${Object.keys(scene.poses).join(", ")}`);
      return { el, legs: legs.filter((n) => scene.poses[n]), fov: num(el, "data-ss-fov", 0), orbit: num(el, "data-ss-orbit", 0), push: num(el, "data-ss-push", 0), ease: el.getAttribute("data-ss-ease") || "inout" };
    }).filter((a) => a.legs.length);
  }

  API.pose = (name) => poseOf(scene.poses[name]);
  API.project = (world) => splat.project(world);
  API.flyTo = (nameOrPose, ms) => {
    const pose = typeof nameOrPose === "string" ? poseOf(scene.poses[nameOrPose]) : nameOrPose;
    if (!pose) return null;
    override = { pose: { ...pose, fov: pose.fov || baseFov() }, until: performance.now() + (ms || 2600) };
    return pose;
  };
  return splat;
}

/* {t, a, h} walk coordinates -> world, the same mapping the scene manifest uses:
   t along the captured path, a across it, h above the ground plane. Raw [x,y,z]
   passes through, so a pin can be written either way. */
API.resolve = (pos) => {
  if (Array.isArray(pos)) return pos.slice(0, 3).map(Number);
  const s = API.scene;
  const t = Number(pos.t) || 0, a = Number(pos.a) || 0, h = Number(pos.h) || 0;
  const along = lerp(s.fwd0, s.fwd1, t);
  const up = v.norm(s.up), fwd = v.norm(s.fwd);
  const right = s.right ? v.norm(s.right) : v.norm(v.cross(up, fwd));
  const ground = s.ground || s.origin;
  const base = v.add(s.origin, v.add(v.scale(fwd, along), v.scale(right, a)));
  const drop = v.dot(v.sub(base, ground), up);
  return v.add(base, v.scale(up, h - drop));
};

function poseOf(p) {
  if (!p) return { eye: [0, 0, -1], target: [0, 0, 0] };
  return { eye: API.resolve(p.eye), target: API.resolve(p.target), fov: p.fov };
}
