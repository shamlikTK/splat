/* ============================================================================
   viewer.js: the full capture in a free orbit viewer.

   "Full capture" in the chrome opens a full-screen dialog with its own
   renderer, loads the page's complete capture file (window.MMNJ_PAGE.viewer),
   and lets the visitor orbit the whole scan: drag to turn, wheel or pinch to
   zoom, arrow keys to turn and step, plus or minus to zoom. It starts from the
   page's rise pose, which is the view of the ground as a whole.

   The walk's own renderer pauses while the viewer is open. The viewer's
   renderer is created once and kept, so reopening does not download again.
   Reuses window.VenueSplat (splat.js) and the frame basis from window.MMNJ_WALK.
   ========================================================================== */
(function () {
  'use strict';
  var PAGE = window.MMNJ_PAGE || {}, WALK = window.MMNJ_WALK;
  var dlg = document.getElementById('viewer'), canvas = document.getElementById('viewer-canvas');
  var btn = document.getElementById('viewer-open');
  if (!dlg || !canvas || !btn || !WALK || !window.VenueSplat) return;
  var status = document.getElementById('viewer-status'), countEl = document.getElementById('viewer-count');
  var glInfo = VenueSplat.probe();
  if (!glInfo.supported) { btn.hidden = true; return; }

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  var q = new URLSearchParams(location.search);
  var V = Object.assign({ file: PAGE.full || PAGE.file, fileMobile: null, fileLite: null, lod: false, size: 1.0 }, PAGE.viewer || {});
  var file = glInfo.software ? (V.fileLite || V.fileMobile || V.file) : (coarse && V.fileMobile ? V.fileMobile : V.file);

  var F = WALK.frame, UP = F.up, FWD = F.fwd, RIGHT = F.right, CFG = WALK.config;
  var v3 = WALK.v3;
  var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };

  // Orbit state, derived from the rise pose: the centre is what it looks at.
  var center = CFG.poses.rise.target.slice(), d0 = v3.len(v3.sub(CFG.poses.rise.eye, center));
  var home = (function () {
    var dir = v3.norm(v3.sub(CFG.poses.rise.eye, center));
    var pitch = Math.asin(clamp(v3.dot(dir, UP), -1, 1));
    var yaw = Math.atan2(v3.dot(dir, RIGHT), v3.dot(dir, v3.scale(FWD, -1)));
    return { yaw: yaw, pitch: pitch, dist: d0 };
  })();
  var cam = { yaw: home.yaw, pitch: home.pitch, dist: home.dist }, shown = { yaw: home.yaw, pitch: home.pitch, dist: home.dist };
  var PITCH_MIN = -4 * Math.PI / 180, PITCH_MAX = 86 * Math.PI / 180, DIST_MIN = d0 * 0.2, DIST_MAX = d0 * 3;
  function eyeOf(c) {
    var cp = Math.cos(c.pitch);
    return v3.add(center, v3.scale(v3.add(v3.add(v3.scale(FWD, -cp * Math.cos(c.yaw)), v3.scale(RIGHT, cp * Math.sin(c.yaw))), v3.scale(UP, Math.sin(c.pitch))), c.dist));
  }

  var splat = null, loaded = false, raf = 0;
  function mount() {
    splat = VenueSplat.create(canvas, { eye: eyeOf(cam), target: center, up: UP, fov: 50, lod: !glInfo.software && V.lod, size: V.size, maxDpr: 1.25 });
    if (!splat) { status.textContent = 'This browser cannot draw the capture.'; return; }
    status.textContent = 'Loading the full capture';
    splat.on('progress', function (p) { status.textContent = p >= 1 ? '' : 'Loading the full capture ' + Math.round(p * 100) + '%'; });
    splat.on('ready', function (n) { countEl.textContent = n.toLocaleString() + ' splats'; });
    splat.load(file).then(function () { loaded = true; }).catch(function (err) { console.error('[viewer]', err); status.textContent = 'The capture could not be loaded.'; });
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    if (!splat) return;
    var k = reduce ? 1 : 0.18;
    shown.yaw += (cam.yaw - shown.yaw) * k; shown.pitch += (cam.pitch - shown.pitch) * k; shown.dist += (cam.dist - shown.dist) * k;
    if (Math.abs(cam.yaw - shown.yaw) < 1e-4 && Math.abs(cam.pitch - shown.pitch) < 1e-4 && Math.abs(cam.dist - shown.dist) < 1e-4) { shown.yaw = cam.yaw; shown.pitch = cam.pitch; shown.dist = cam.dist; }
    var e = eyeOf(shown), r4 = function (v) { return [Math.round(v[0] * 5000) / 5000, Math.round(v[1] * 5000) / 5000, Math.round(v[2] * 5000) / 5000]; };
    splat.set({ eye: r4(e), target: r4(center) });
  }

  function open() {
    dlg.showModal();
    var walkSplat = WALK.splat(); if (walkSplat) walkSplat.pause(true);
    if (!splat) mount(); else { splat.resize(); splat.pause(false); }
    cancelAnimationFrame(raf); tick();
    document.getElementById('viewer-close').focus();
  }
  function close() { dlg.close(); }
  dlg.addEventListener('close', function () {
    cancelAnimationFrame(raf);
    if (splat) splat.pause(true);
    var walkSplat = WALK.splat(); if (walkSplat) walkSplat.pause(document.hidden);
    try { btn.focus({ preventScroll: true }); } catch (err) { /* nothing to focus */ }
  });
  btn.addEventListener('click', function (e) { e.preventDefault(); open(); });
  document.getElementById('viewer-close').addEventListener('click', close);
  document.getElementById('viewer-reset').addEventListener('click', function () { cam.yaw = home.yaw; cam.pitch = home.pitch; cam.dist = home.dist; });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });

  /* ---- orbit input: drag, wheel, pinch, keys ------------------------------ */
  var drag = null, pinch = null, touches = {};
  canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(touches);
    if (ids.length === 2) { var a = touches[ids[0]], b = touches[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist }; drag = null; }
    else { drag = { x: e.clientX, y: e.clientY }; }
    canvas.setPointerCapture(e.pointerId);
    dlg.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!(e.pointerId in touches)) return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(touches);
    if (pinch && ids.length === 2) {
      var a = touches[ids[0]], b = touches[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.dist = clamp(pinch.dist * (pinch.d / Math.max(d, 1)), DIST_MIN, DIST_MAX);
    } else if (drag) {
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
      cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.006, PITCH_MIN, PITCH_MAX);
    }
  });
  function up(e) { delete touches[e.pointerId]; if (Object.keys(touches).length < 2) pinch = null; if (!Object.keys(touches).length) { drag = null; dlg.classList.remove('is-dragging'); } }
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0012), DIST_MIN, DIST_MAX); }, { passive: false });
  dlg.addEventListener('keydown', function (e) {
    var step = 6 * Math.PI / 180;
    if (e.key === 'ArrowLeft') cam.yaw -= step; else if (e.key === 'ArrowRight') cam.yaw += step;
    else if (e.key === 'ArrowUp') cam.pitch = clamp(cam.pitch + step, PITCH_MIN, PITCH_MAX); else if (e.key === 'ArrowDown') cam.pitch = clamp(cam.pitch - step, PITCH_MIN, PITCH_MAX);
    else if (e.key === '+' || e.key === '=') cam.dist = clamp(cam.dist * 0.85, DIST_MIN, DIST_MAX); else if (e.key === '-') cam.dist = clamp(cam.dist / 0.85, DIST_MIN, DIST_MAX);
    else return;
    e.preventDefault();
  });
  addEventListener('resize', function () { if (dlg.open && splat) splat.resize(); });

  window.MMNJ_VIEWER = { open: open, close: close, isOpen: function () { return dlg.open; }, camera: function () { return { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, eye: eyeOf(shown) }; }, splat: function () { return splat; }, loaded: function () { return loaded; } };
})();
