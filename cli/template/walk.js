/* ============================================================================
   walk.js: MMNJ Sports Day, one walk through the ground.

   The page is one live 3D capture of the venue on a fixed stage. Scroll walks
   the camera along one authored path; the waypoints are the photos, anchored
   as pins at real positions in the capture. The album list in index.html is
   the data: every `.shot` there becomes a pin, a hanging frame and a stop on
   the walk, so adding a photo is adding a list item.

   Legs:  gate -> photo 1 .. photo m -> the rise (the peak) -> photo m+1 .. n -> the overlook
   Nav:   the route map (a plan of the ground drawn from the capture itself)
   Move:  pin flight. Click any pin and the camera flies there; the photo blooms
          out of the pin where it was taken; click it again for full screen.

   Reuses window.ScrollCraft (never edited; it only marks the page ready here,
   there are no acts) and window.VenueSplat (splat.js).
   ========================================================================== */
(function () {
  'use strict';

  /* ---- configuration --------------------------------------------------- */
  // Generic behaviour lives here. Everything about a particular capture (file,
  // frame, ground, poses, budgets) comes from window.MMNJ_PAGE, written into
  // each page by tools/build-pages.mjs from its manifest.
  var DEFAULTS = {
    file: 'assets/venue.splat',
    // The capture's frame: up is the ground normal, fwd the walking direction.
    frame: { up: [0, -1, 0], fwd: [0, 0, 1] },
    ground: { point: [0, 0, 0] },         // a point on the ground plane; the normal is frame.up
    axis: { origin: [0, 0, 0], back: 0.8 }, // the capture axis: origin + fwd * s; `back` is how far behind a pin the approach starts
    eyeHeight: 0.13,       // how far the walking camera stands above the ground
    standBack: 0.56,       // how far it stops short of a pin
    labels: { gate: 'The gate', rise: 'Above the ground', close: 'The overlook' },
    poses: { gate: null, rise: null, close: null },   // { eye, target } in world coordinates; required per page
    legs: { first: 1.3, photo: 1.2, rise: 2.4, afterRise: 1.4, close: 1.3 },
    hold: { photo: 0.3, rise: 0.32 },   // the last fraction of a leg spent still at its waypoint
    fov: { desktop: 52, mobile: 64, riseWiden: 6 },
    look: { yaw: 5.5, pitch: 3 },      // degrees of pointer lean, fine pointers only
    // Free look at the stops: drag (or swipe sideways, or the arrow keys) turns the
    // view while the camera stands at a pin, the gate, the rise or the overlook.
    // The bounds keep the view inside the angles a forward capture actually has.
    freeLook: { yawMax: 32, pitchMin: -24, pitchMax: 18, perPx: 0.11, keyStep: 6, easeBack: 0.28 },   // easeBack: seconds to fall to 37%
    // Per-device profiles: which SOG to load (a decimated one for phones and software
    // renderers), whether Spark builds a level-of-detail tree at load (off: generation
    // for millions of splats delays the first frame by many seconds), and the pixel-ratio cap.
    desktop: { file: null, lod: false, size: 1, maxDpr: 1.5 },
    mobile:  { file: null, lod: false, size: 1, maxDpr: 1.25 },
    software:{ file: null, lod: false, size: 1, maxDpr: 1 }
  };
  function merge(base, over) {
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(over || {}).forEach(function (k) {
      var b = base[k], o = over[k];
      out[k] = (b && o && typeof b === 'object' && typeof o === 'object' && !Array.isArray(b) && !Array.isArray(o)) ? merge(b, o) : o;
    });
    return out;
  }
  var CFG = merge(DEFAULTS, window.MMNJ_PAGE || {});
  if (!CFG.poses.gate || !CFG.poses.rise || !CFG.poses.close) console.error('[walk] the page config needs gate, rise and close poses');

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var smallMQ = matchMedia('(max-width: 860px)');
  var isMobile = function () { return smallMQ.matches || matchMedia('(hover: none) and (pointer: coarse)').matches; };
  var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  var clamp01 = function (x) { return clamp(x, 0, 1); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (t) { t = clamp01(t); return t * t * (3 - 2 * t); };
  var easeInOut = function (t) { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var $ = function (id) { return document.getElementById(id); };
  var v3 = {
    add: function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
    sub: function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
    scale: function (a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
    mix: function (a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; },
    len: function (a) { return Math.hypot(a[0], a[1], a[2]); },
    norm: function (a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
    cross: function (a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  };
  var UP = v3.norm(CFG.frame.up);
  // Forward is the capture axis flattened onto the ground; right is across it (screen-right on the plan).
  var FWD = v3.norm(v3.sub(CFG.frame.fwd, v3.scale(UP, v3.dot(CFG.frame.fwd, UP))));
  var RIGHT = v3.norm(v3.cross(UP, FWD));
  // Drop a point straight onto the ground plane, and lift it by h.
  function onGround(p, h) { var d = v3.dot(v3.sub(p, CFG.ground.point), UP); return v3.add(p, v3.scale(UP, -d + (h || 0))); }

  /* ---- elements -------------------------------------------------------- */
  var stage = $('stage'), canvas = $('splat'), poster = $('poster'), pinsLayer = $('pins'), loadEl = $('load'), hint = $('look-hint');
  var hero = $('hero'), heroTitle = hero.querySelector('.hero__title'), heroLede = hero.querySelector('.hero__lede'), heroScrim = $('hero-scrim'), riseLine = $('rise-line'), riseScrim = $('rise-scrim'), mark = $('mark'), cta = $('cta');
  var album = $('album'), albumVeil = $('album-veil'), track = $('track');
  var map = $('map'), plan = $('map-plan'), mapPins = $('map-pins'), mapWhere = $('map-where');
  var light = $('light'), lightImg = $('light-img'), lightTitle = $('light-title'), lightSpot = $('light-spot'), lightDl = $('light-download');

  if (window.ScrollCraft) ScrollCraft.mount(document.body);

  /* ---- the spots and their photos: read from the album --------------------- */
  // A spot is one pin on the ground with one or more photos. In the album a
  // multi-photo spot is <li class="spot"> holding <li class="shot"> items; a
  // single-photo spot is the same with one shot and the spot name in its caption.
  var SPOTS = Array.prototype.map.call(document.querySelectorAll('#album-grid > .spot'), function (li, si) {
    var pin = (li.dataset.pin || '0 0 1').split(/\s+/).map(Number);
    var eyeAttr = li.dataset.eye ? li.dataset.eye.split(/\s+/).map(Number) : null;
    var nameEl = li.querySelector('.spot__name');
    var photos = Array.prototype.map.call(li.querySelectorAll('.shot'), function (sh, k) {
      var link = sh.querySelector('.shot__link'), img = sh.querySelector('img');
      return { el: sh, spot: si, k: k, full: link.getAttribute('href'), thumb: img.getAttribute('src'), alt: img.getAttribute('alt') || '',
        title: (sh.querySelector('.shot__title') || {}).textContent || ('Photo ' + (k + 1)),
        w: +img.getAttribute('width') || 480, h: +img.getAttribute('height') || 640 };
    });
    var label = li.dataset.label || (nameEl ? nameEl.firstChild.textContent.trim() : '') || (li.querySelector('.shot__spot') || {}).textContent || ('Spot ' + (si + 1));
    return { i: si, el: li, pin: pin, eyeOverride: eyeAttr, label: label, photos: photos };
  });
  var PHOTOS = [];
  SPOTS.forEach(function (s) { s.photos.forEach(function (p) { p.i = PHOTOS.length; PHOTOS.push(p); }); });

  /* ---- waypoints and the track ------------------------------------------ */
  // Where the camera stands to look at a pin: back along the approach from a
  // point on the capture axis behind the pin (so it never looks across the
  // wedge), at eye height above the ground.
  function standFor(pin) {
    var s = v3.dot(v3.sub(pin, CFG.axis.origin), FWD);
    var A = v3.add(CFG.axis.origin, v3.scale(FWD, s - CFG.axis.back));
    var dir = v3.sub(pin, A); dir = v3.norm(v3.sub(dir, v3.scale(UP, v3.dot(dir, UP))));
    return onGround(v3.sub(pin, v3.scale(dir, CFG.standBack)), CFG.eyeHeight);
  }
  var WAY = [];       // { key, label, eye, target, w (leg weight before it), hold, spot }
  function buildWaypoints() {
    WAY.length = 0;
    WAY.push({ key: 'gate', label: CFG.labels.gate, eye: CFG.poses.gate.eye, target: CFG.poses.gate.target, w: 0, hold: 0 });
    var m = Math.max(1, Math.ceil(SPOTS.length * 0.6));
    SPOTS.forEach(function (s, i) {
      var eye = s.eyeOverride || standFor(s.pin);
      WAY.push({ key: 'spot', spot: s, label: s.label, eye: eye, target: v3.add(s.pin, v3.scale(UP, 0.01)),
        w: i === 0 ? CFG.legs.first : (i === m ? CFG.legs.afterRise : CFG.legs.photo), hold: CFG.hold.photo });
      if (i === m - 1) WAY.push({ key: 'rise', label: CFG.labels.rise, eye: CFG.poses.rise.eye, target: CFG.poses.rise.target, w: CFG.legs.rise, hold: CFG.hold.rise });
    });
    if (SPOTS.length === 0) WAY.push({ key: 'rise', label: CFG.labels.rise, eye: CFG.poses.rise.eye, target: CFG.poses.rise.target, w: CFG.legs.rise, hold: CFG.hold.rise });
    WAY.push({ key: 'close', label: CFG.labels.close, eye: CFG.poses.close.eye, target: CFG.poses.close.target, w: CFG.legs.close, hold: 0 });
    var c = 0;
    WAY.forEach(function (w) { c += w.w; w.at = c; });   // w.at: track position (in vh) where the camera is AT this waypoint (end of its leg)
    WAY.forEach(function (w, i) { w.arrive = i === 0 ? 0 : WAY[i - 1].at + w.w * (1 - w.hold); }); // where the hold begins
  }
  buildWaypoints();
  var TOTAL = WAY[WAY.length - 1].at;
  function wayOfSpot(i) { for (var k = 0; k < WAY.length; k++) if (WAY[k].spot && WAY[k].spot.i === i) return WAY[k]; return null; }
  var RISE = WAY.filter(function (w) { return w.key === 'rise'; })[0];
  var CLOSE = WAY[WAY.length - 1];

  var vh = innerHeight, vw = innerWidth;
  function layoutTrack() {
    vh = innerHeight; vw = innerWidth;
    // (legs + 1) viewport-heights, in pixels, so the last leg has room to land.
    track.style.height = Math.round((TOTAL + 1) * vh) + 'px';
  }
  layoutTrack();

  // Position along the track in viewport-heights, and the leg it falls in.
  function trackT() { return clamp(scrollY / Math.max(vh, 1), 0, TOTAL); }
  function legAt(t) {
    for (var i = 1; i < WAY.length; i++) if (t <= WAY[i].at) return { i: i, u: (t - WAY[i - 1].at) / Math.max(WAY[i].w, 1e-6) };
    return { i: WAY.length - 1, u: 1 };
  }
  // Remap a leg's progress so the camera arrives before the end and holds.
  function travelU(leg) { var w = WAY[leg.i]; return easeInOut(clamp01(leg.u / Math.max(1 - w.hold, 1e-6))); }

  // Catmull-Rom through the waypoint poses; tension kept so the camera never
  // overshoots into the wedge walls between two close stops.
  function crPoint(pts, i, u) {
    var p0 = pts[Math.max(i - 2, 0)], p1 = pts[i - 1], p2 = pts[i], p3 = pts[Math.min(i + 1, pts.length - 1)];
    var t2 = u * u, t3 = t2 * u, k = 0.35, out = [];
    for (var a = 0; a < 3; a++) {
      var m1 = k * (p2[a] - p0[a]), m2 = k * (p3[a] - p1[a]);
      out[a] = (2 * t3 - 3 * t2 + 1) * p1[a] + (t3 - 2 * t2 + u) * m1 + (-2 * t3 + 3 * t2) * p2[a] + (t3 - t2) * m2;
    }
    return out;
  }
  var EYES = WAY.map(function (w) { return w.eye; }), TARGETS = WAY.map(function (w) { return w.target; });
  function cameraAt(t) {
    var leg = legAt(t), u = travelU(leg);
    if (reduce) {
      // Reduced motion: the camera steps between stops instead of travelling.
      var w = u < 0.5 ? WAY[leg.i - 1] : WAY[leg.i];
      return { eye: w.eye, target: w.target, leg: leg, u: u };
    }
    return { eye: crPoint(EYES, leg.i, u), target: crPoint(TARGETS, leg.i, u), leg: leg, u: u };
  }

  /* ---- renderer -------------------------------------------------------- */
  var glInfo = window.VenueSplat ? VenueSplat.probe() : { supported: false, software: false };
  var profile = glInfo.software ? CFG.software : (isMobile() ? CFG.mobile : CFG.desktop);
  var q = new URLSearchParams(location.search);
  var splat = null;
  function baseFov() { return isMobile() ? CFG.fov.mobile : CFG.fov.desktop; }
  function noGL() { stage.classList.add('no-gl'); map.hidden = true; loadEl.textContent = ''; }
  function mountSplat() {
    if (!(glInfo.supported && window.VenueSplat)) { noGL(); return; }
    splat = VenueSplat.create(canvas, { eye: CFG.poses.gate.eye, target: CFG.poses.gate.target, up: UP, fov: baseFov(),
      lod: profile.lod, size: profile.size, maxDpr: profile.maxDpr, sample: 48000 });
    if (!splat) { noGL(); return; }
    stage.classList.add('is-loading');
    loadEl.textContent = 'Loading the ground';
    splat.on('progress', function (p) { loadEl.textContent = p >= 1 ? '' : 'Loading the ground ' + Math.round(p * 100) + '%'; });
    splat.on('paint', function () { stage.classList.add('is-live'); stage.classList.remove('is-loading'); });
    splat.on('sample', drawPlan);
    splat.load((profile.file || CFG.file) + (q.get('v') ? '?v=' + q.get('v') : '')).catch(function (err) {
      console.error('[walk] capture failed to load', err); noGL();
    });
  }

  /* ---- pins and frames: one per spot ------------------------------------ */
  var PINS = SPOTS.map(function (s) {
    var n = s.photos.length, first = s.photos[0];
    var b = document.createElement('button');
    b.className = 'pin'; b.type = 'button'; b.dataset.i = s.i;
    b.setAttribute('aria-label', s.label + ', ' + (n === 1 ? first.title : n + ' photos') + '. Fly there and open ' + (n === 1 ? 'the photo.' : 'them.'));
    b.innerHTML = '<span class="pin__art" aria-hidden="true"><span class="pin__halo"></span><span class="pin__ring"></span><span class="pin__dot"></span></span><span class="pin__label" aria-hidden="true"></span>';
    b.querySelector('.pin__label').textContent = n === 1 ? s.label : s.label + ' · ' + n;
    // The frame: one photo, or a stack of the first three with the count.
    var f = document.createElement('figure');
    f.className = 'frame' + (n > 1 ? ' frame--stack' : ''); f.dataset.i = s.i;
    var stack = s.photos.slice(0, 3).map(function (p, k) {
      return '<img class="frame__img frame__img--' + k + '" alt="" data-src="' + p.thumb.replace(/"/g, '&quot;') + '" width="' + p.w + '" height="' + p.h + '">';
    }).reverse().join('');
    f.innerHTML = '<span class="frame__tether" aria-hidden="true"></span><div class="frame__inner">'
      + '<button class="frame__open" type="button"><span class="frame__stack">' + stack + '</span>'
      + (n > 1 ? '<span class="frame__count">' + n + ' photos</span>' : '') + '</button>'
      + '<figcaption class="frame__cap"><strong></strong> <span></span></figcaption></div>';
    f.querySelector('.frame__img--0').alt = first.alt;
    f.querySelector('.frame__open').setAttribute('aria-label', n === 1 ? 'Open ' + first.title + ' full screen' : 'Open the ' + n + ' photos from ' + s.label);
    f.querySelector('strong').textContent = n === 1 ? first.title : s.label;
    f.querySelector('.frame__cap span').textContent = n === 1 ? s.label : n + ' photos';
    pinsLayer.appendChild(b); pinsLayer.appendChild(f);   // button first, so its frame is next in tab order
    return { spot: s, btn: b, frame: f, way: null, visited: false, open: false, near: false, behind: false, bloom: -1, loaded: false };
  });
  PINS.forEach(function (pin) { pin.way = wayOfSpot(pin.spot.i); });
  // Frame thumbnails load a leg before their stop, not at page load.
  function loadFrame(pin) {
    if (pin.loaded) return; pin.loaded = true;
    pin.frame.querySelectorAll('img[data-src]').forEach(function (img) { img.src = img.dataset.src; img.removeAttribute('data-src'); });
  }

  // Bloom of a spot at track position t: rises as the camera settles on its
  // waypoint, holds through the stop, and closes over the start of the next leg.
  function bloomFor(way, t) {
    var start = way.arrive - way.w * 0.08, full = way.arrive + Math.min(way.w * 0.06, 0.08);
    var end = way.at + 0.18, gone = way.at + 0.42;
    if (t < start || t > gone) return 0;
    if (t < full) return smooth((t - start) / Math.max(full - start, 1e-6));
    if (t < end) return 1;
    return 1 - smooth((t - end) / Math.max(gone - end, 1e-6));
  }

  /* ---- copy windows ----------------------------------------------------- */
  // A plateau window against the track: ramps in, holds, ramps out. Returns 0..1.
  function windowAt(t, from, to, rIn, rOut) {
    if (t <= from || t >= to) return 0;
    var a = rIn > 0 ? clamp01((t - from) / rIn) : 1, b = rOut > 0 ? clamp01((to - t) / rOut) : 1;
    return smooth(Math.min(a, b));
  }
  function setWindow(el, w, ty) {
    var ws = w.toFixed(3);
    if (el.dataset.w !== ws) { el.dataset.w = ws; el.style.setProperty('--w', ws); el.classList.toggle('is-hot', w > 0.5); }
    if (ty != null) el.style.setProperty('--ty', ty.toFixed(1) + 'px');
  }

  /* ---- the route map ---------------------------------------------------- */
  var pctx = plan.getContext('2d'), planBase = null, mapBox = null, MAP_W = plan.width, MAP_H = plan.height;
  function toPlan(p) {
    // ground coordinates: right across the wedge, forward along it
    var u = v3.dot(p, RIGHT), v = v3.dot(p, FWD);
    return [u, v];
  }
  function mapXY(p) {
    var g = toPlan(p);
    var x = (g[0] - mapBox.u0) / (mapBox.u1 - mapBox.u0), y = 1 - (g[1] - mapBox.v0) / (mapBox.v1 - mapBox.v0);
    // The rise and the overlook stand behind the gate, off the plan; the dot parks at the edge.
    return [clamp(x, 0.05, 0.95) * MAP_W, clamp(y, 0.05, 0.95) * MAP_H];
  }
  function drawPlan(bytes) {
    var ROW = 32, n = Math.floor(bytes.length / ROW);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var pts = [];
    for (var i = 0; i < n; i++) {
      var o = ROW * i, p = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)];
      var g = toPlan(p); pts.push({ u: g[0], v: g[1], r: bytes[o + 24], g: bytes[o + 25], b: bytes[o + 26], a: bytes[o + 27] });
    }
    // Frame the plan on the walk itself (the gate, every pin and every stand), not the whole
    // capture: a long scan with stops in its first half would otherwise crowd the pins.
    var u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    var grow = function (p) { var g = toPlan(p); u0 = Math.min(u0, g[0]); u1 = Math.max(u1, g[0]); v0 = Math.min(v0, g[1]); v1 = Math.max(v1, g[1]); };
    WAY.forEach(function (w) { if (w.key === 'rise' || w.key === 'close') return; grow(w.eye); if (w.spot) grow(w.spot.pin); });
    var pad = 0.3 * Math.max(u1 - u0, v1 - v0, 0.5); u0 -= pad; u1 += pad; v0 -= pad; v1 += pad;
    // Keep the plan's aspect: fit the box into the canvas ratio.
    var boxAspect = (u1 - u0) / (v1 - v0), cAspect = MAP_W / MAP_H;
    if (boxAspect > cAspect) { var nh = (u1 - u0) / cAspect, cv = (v0 + v1) / 2; v0 = cv - nh / 2; v1 = cv + nh / 2; }
    else { var nw = (v1 - v0) * cAspect, cu = (u0 + u1) / 2; u0 = cu - nw / 2; u1 = cu + nw / 2; }
    mapBox = { u0: u0, u1: u1, v0: v0, v1: v1 };
    // Paint the capture's splats as the plan, dimmed so the route reads on top.
    var off = document.createElement('canvas'); off.width = MAP_W; off.height = MAP_H;
    var c = off.getContext('2d');
    c.fillStyle = '#0F1612'; c.fillRect(0, 0, MAP_W, MAP_H);
    pts.forEach(function (p) {
      var x = (p.u - u0) / (u1 - u0) * MAP_W, y = (1 - (p.v - v0) / (v1 - v0)) * MAP_H;
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
      c.fillStyle = 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',0.55)';
      c.fillRect(x - 1.5, y - 1.5, 3, 3);
    });
    c.fillStyle = 'rgba(10,15,12,0.42)'; c.fillRect(0, 0, MAP_W, MAP_H);
    planBase = off;
    placeMapPins();
    lastMapKey = '';
  }
  mapPins.hidden = true;   // placed once the plan is drawn
  var MAP_PINS = SPOTS.map(function (s) {
    var b = document.createElement('button'); b.className = 'map__pin'; b.type = 'button'; b.dataset.i = s.i;
    b.setAttribute('aria-label', 'Fly to ' + s.label);
    mapPins.appendChild(b); return b;
  });
  function placeMapPins() {
    if (!mapBox) return;
    mapPins.hidden = false;
    MAP_PINS.forEach(function (b, i) { var xy = mapXY(SPOTS[i].pin); b.style.left = (xy[0] / MAP_W * 100).toFixed(2) + '%'; b.style.top = (xy[1] / MAP_H * 100).toFixed(2) + '%'; });
  }
  var lastMapKey = '';
  function drawMap(cam, t) {
    if (!planBase) return;
    var key = Math.round(t * 200) + '|' + PINS.map(function (p) { return p.visited ? 1 : 0; }).join('');
    if (key === lastMapKey) return; lastMapKey = key;
    pctx.clearRect(0, 0, MAP_W, MAP_H);
    pctx.drawImage(planBase, 0, 0);
    // The whole path, faint; the walked part in the accent.
    var samples = 160, pathPts = [];
    for (var s = 0; s <= samples; s++) { var tt = TOTAL * s / samples; var e = reduce ? cameraAt(tt).eye : crPoint(EYES, legAt(tt).i, travelU(legAt(tt))); pathPts.push({ t: tt, xy: mapXY(e) }); }
    pctx.lineWidth = 3; pctx.lineCap = 'round'; pctx.lineJoin = 'round';
    pctx.strokeStyle = 'rgba(167,179,166,0.45)';
    pctx.beginPath(); pathPts.forEach(function (p, i) { pctx[i ? 'lineTo' : 'moveTo'](p.xy[0], p.xy[1]); }); pctx.stroke();
    pctx.strokeStyle = '#FF5B3A';
    pctx.beginPath(); var started = false;
    pathPts.forEach(function (p) { if (p.t > t) return; pctx[started ? 'lineTo' : 'moveTo'](p.xy[0], p.xy[1]); started = true; });
    var here = mapXY(cam.eye); pctx.lineTo(here[0], here[1]); pctx.stroke();
    // You are here: a dot with a heading wedge.
    var look = mapXY(v3.add(cam.eye, v3.scale(v3.norm(v3.sub(cam.target, cam.eye)), 0.6)));
    var ang = Math.atan2(look[1] - here[1], look[0] - here[0]);
    pctx.fillStyle = 'rgba(255,91,58,0.22)';
    pctx.beginPath(); pctx.moveTo(here[0], here[1]); pctx.arc(here[0], here[1], 54, ang - 0.42, ang + 0.42); pctx.closePath(); pctx.fill();
    pctx.fillStyle = '#F3EEE4'; pctx.beginPath(); pctx.arc(here[0], here[1], 7, 0, 6.2832); pctx.fill();
    pctx.strokeStyle = '#FF5B3A'; pctx.lineWidth = 3; pctx.beginPath(); pctx.arc(here[0], here[1], 7, 0, 6.2832); pctx.stroke();
  }

  /* ---- fly to ----------------------------------------------------------- */
  var flight = null;
  function flyTo(t, done) {
    var from = scrollY, to = clamp(t, 0, TOTAL) * vh, dist = Math.abs(to - from);
    if (reduce || dist < 2) { scrollTo({ top: to, behavior: 'instant' }); if (done) done(); return; }
    var dur = clamp(600 + dist / vh * 380, 700, 2200), t0 = performance.now();
    flight = { cancel: false };
    var f = flight;
    (function step(now) {
      if (f.cancel) return;
      var k = easeInOut(clamp01((now - t0) / dur));
      scrollTo({ top: Math.round(lerp(from, to, k)), behavior: 'instant' });
      if (k < 1) requestAnimationFrame(step); else { flight = null; if (done) done(); }
    })(t0);
  }
  // A wheel or touch during a flight hands control back to the hand.
  ['wheel', 'touchstart', 'keydown'].forEach(function (ev) { addEventListener(ev, function () { if (flight) { flight.cancel = true; flight = null; } }, { passive: true }); });
  function goToSpot(i) { var w = wayOfSpot(i); if (w) flyTo(w.arrive + Math.min(w.w * 0.06, 0.08) + 0.02); }

  pinsLayer.addEventListener('click', function (e) {
    var open = e.target.closest('.frame__open');
    if (open) { openSpot(+open.closest('.frame').dataset.i, open); return; }
    var b = e.target.closest('.pin'); if (!b) return;
    var i = +b.dataset.i, pin = PINS[i];
    if (pin.open) openSpot(i, b); else goToSpot(i);
  });
  mapPins.addEventListener('click', function (e) { var b = e.target.closest('.map__pin'); if (b) goToSpot(+b.dataset.i); });
  // The one action reads "Open the album" on the walk and "Back to the walk" once the album is up.
  var ctaLabel = cta.textContent, ctaAtAlbum = false;
  cta.addEventListener('click', function (e) {
    e.preventDefault();
    if (ctaAtAlbum) { var last = WAY.filter(function (w) { return w.spot; }).pop(); flyTo(last ? last.arrive + Math.min(last.w * 0.06, 0.08) + 0.02 : 0); }
    else flyTo(TOTAL);
  });
  mark.addEventListener('click', function (e) { e.preventDefault(); flyTo(0); });
  document.querySelector('.skip').addEventListener('click', function (e) { e.preventDefault(); flyTo(TOTAL, function () { album.querySelector('.shot__link').focus(); }); });
  // The album's own links open the photo full screen instead of leaving the page.
  album.addEventListener('click', function (e) {
    var a = e.target.closest('.shot__link'); if (!a) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); openLight(Array.prototype.indexOf.call(album.querySelectorAll('.shot'), a.closest('.shot')), a);
  });
  album.addEventListener('click', function (e) {
    var h = e.target.closest('.spot__open'); if (!h) return;
    e.preventDefault(); openSpot(+h.closest('.spot').dataset.i, h);
  });

  /* ---- the lightbox: a spot's photos as a group, or one photo large ----------- */
  var lightIndex = -1, lightReturn = null, lightGroup = null;   // lightGroup: the spot shown as a grid, or null
  var lightGroupEl = $('light-group'), lightGrid = $('light-grid'), lightFig = $('light-fig'), lightBack = $('light-back'), lightCount = $('light-count');
  // Paging: within the spot when it has several photos, across spots (first photos) when every spot is one photo.
  function neighbours(i) {
    var p = PHOTOS[i], s = SPOTS[p.spot];
    return s.photos.length > 1 ? s.photos : SPOTS.map(function (sp) { return sp.photos[0]; });
  }
  function stepLight(dir) {
    var list = neighbours(lightIndex), at = list.indexOf(PHOTOS[lightIndex]);
    showLight(list[(at + dir + list.length) % list.length].i);
  }
  function showLight(i) {
    var p = PHOTOS[i], s = SPOTS[p.spot]; lightIndex = i;
    lightGroup = null; lightGroupEl.hidden = true; lightFig.hidden = false;
    lightImg.src = p.full; lightImg.alt = p.alt;
    lightTitle.textContent = p.title; lightSpot.textContent = s.label;
    lightCount.textContent = s.photos.length > 1 ? (p.k + 1) + ' of ' + s.photos.length : '';
    lightDl.href = p.full; lightDl.setAttribute('download', p.full.split('/').pop()); lightDl.hidden = false;
    var many = neighbours(i).length > 1;
    $('light-prev').hidden = !many; $('light-next').hidden = !many;
    lightBack.hidden = s.photos.length < 2;
    lightBack.textContent = 'All ' + s.photos.length + ' photos';
    light.setAttribute('aria-labelledby', 'light-title');
  }
  function showGroup(si) {
    var s = SPOTS[si]; lightGroup = s; lightIndex = s.photos[0].i;
    lightFig.hidden = true; lightGroupEl.hidden = false; lightBack.hidden = true; lightDl.hidden = true;
    $('light-prev').hidden = true; $('light-next').hidden = true;
    $('light-group-name').textContent = s.label; $('light-group-count').textContent = s.photos.length + ' photos';
    if (lightGrid.dataset.spot !== String(si)) {
      lightGrid.dataset.spot = String(si);
      lightGrid.innerHTML = s.photos.map(function (p) {
        return '<button class="light__thumb" type="button" data-i="' + p.i + '" aria-label="' + esc(p.title) + '">'
          + '<img src="' + esc(p.thumb) + '" alt="' + esc(p.alt) + '" width="' + p.w + '" height="' + p.h + '" loading="lazy" decoding="async"></button>';
      }).join('');
    }
    light.setAttribute('aria-labelledby', 'light-group-name');
  }
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function openDialog(returnTo, focusEl) {
    lightReturn = returnTo || document.activeElement;
    light.showModal();
    if (splat) splat.pause(true);
    focusEl.focus();
  }
  // One photo, large (from the album, or a single-photo spot).
  function openLight(i, returnTo) {
    if (!light.showModal) { location.href = PHOTOS[i].full; return; }
    showLight(i); openDialog(returnTo, $('light-close'));
  }
  // A spot: its photos as a group (a single-photo spot opens the photo itself).
  function openSpot(si, returnTo) {
    var s = SPOTS[si];
    if (s.photos.length === 1) return openLight(s.photos[0].i, returnTo);
    if (!light.showModal) { location.href = s.photos[0].full; return; }
    showGroup(si); openDialog(returnTo, $('light-close'));
  }
  lightGrid.addEventListener('click', function (e) { var b = e.target.closest('.light__thumb'); if (b) { showLight(+b.dataset.i); $('light-close').focus(); } });
  lightBack.addEventListener('click', function () { showGroup(PHOTOS[lightIndex].spot); $('light-close').focus(); });
  $('light-close').addEventListener('click', function () { light.close(); });
  $('light-prev').addEventListener('click', function () { stepLight(-1); });
  $('light-next').addEventListener('click', function () { stepLight(1); });
  light.addEventListener('keydown', function (e) {
    if (lightGroup) return;   // in the grid the arrows are for tabbing between thumbnails
    if (e.key === 'ArrowLeft') { stepLight(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { stepLight(1); e.preventDefault(); }
  });
  light.addEventListener('click', function (e) { if (e.target === light) light.close(); });
  light.addEventListener('close', function () {
    if (splat) splat.pause(document.hidden);
    var p = lightIndex >= 0 ? PINS[PHOTOS[lightIndex].spot] : null;
    // Return focus to something that is actually on screen.
    var target = lightReturn && lightReturn.isConnected && lightReturn.getClientRects().length > 0 ? lightReturn : (p && !p.btn.hidden ? p.btn : cta);
    try { target.focus({ preventScroll: true }); } catch (err) { /* no focus target */ }
    lightIndex = -1; lightGroup = null;
  });

  /* ---- looking: the pointer lean, and free look at the stops ----------------- */
  var px = 0.5, py = 0.5, pxs = 0.5, pys = 0.5;
  if (fine && !reduce) addEventListener('pointermove', function (e) { if (e.pointerType !== 'mouse') return; px = e.clientX / vw; py = e.clientY / vh; }, { passive: true });

  var look = { yaw: 0, pitch: 0, dragging: false, id: null, lastX: 0, lastY: 0, used: false };
  var FL = CFG.freeLook, curStop = 0;
  // How settled the camera is at a stop: 1 through a stop's hold (and at the gate),
  // ramping in just before arrival and out over the first stretch of the next leg.
  // Ramps scale with the leg, so a page of short legs still has a stretch between stops where a drag is a scroll.
  function stopFactor(t) {
    var f = 1 - smooth(t / 0.5);
    for (var i = 1; i < WAY.length; i++) {
      var w = WAY[i], a = w.arrive - 0.06, b = w.at + Math.min(0.18, 0.12 * w.w);
      var out = Math.min(0.35, 0.25 * (WAY[i + 1] ? WAY[i + 1].w : w.w)), inn = Math.min(0.2, 0.15 * w.w);
      if (t >= a && t <= b) return 1;
      if (t > b && t < b + out) f = Math.max(f, 1 - smooth((t - b) / out));
      if (t < a && t > a - inn) f = Math.max(f, smooth((t - (a - inn)) / inn));
    }
    return clamp01(f);
  }
  function endDrag(e) {
    if (!look.dragging || (e && e.pointerId !== look.id)) return;
    look.dragging = false; stage.classList.remove('is-looking');
  }
  stage.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.pin, .frame, a, button')) return;
    if (curStop < 0.5) return;                  // between stops the gesture is a scroll, not a look
    look.dragging = true; look.id = e.pointerId; look.lastX = e.clientX; look.lastY = e.clientY;
    stage.classList.add('is-looking');
  });
  addEventListener('pointermove', function (e) {
    if (!look.dragging || e.pointerId !== look.id) return;
    var dx = e.clientX - look.lastX, dy = e.clientY - look.lastY; look.lastX = e.clientX; look.lastY = e.clientY;
    // Grab the world: drag right and the scene follows, so the view turns left; drag down and it looks up.
    look.yaw = clamp(look.yaw - dx * FL.perPx, -FL.yawMax, FL.yawMax);
    if (e.pointerType !== 'touch') look.pitch = clamp(look.pitch + dy * FL.perPx, FL.pitchMin, FL.pitchMax);
    if (Math.abs(dx) + Math.abs(dy) > 2) usedLook();
  });
  addEventListener('pointerup', endDrag); addEventListener('pointercancel', endDrag);
  addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]') || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var tg = e.target; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
    if (curStop < 0.5) return;
    look.yaw = clamp(look.yaw + (e.key === 'ArrowRight' ? FL.keyStep : -FL.keyStep), -FL.yawMax, FL.yawMax);
    usedLook(); e.preventDefault();
  });
  // The hint shows once, at the first photo stop, and goes on the first look.
  var hintShown = false, hintTimer = 0;
  try { hintShown = sessionStorage.getItem('mmnj-look-hint') === '1'; } catch (err) { /* storage unavailable */ }
  function showHint() {
    if (hintShown) return; hintShown = true;
    try { sessionStorage.setItem('mmnj-look-hint', '1'); } catch (err) { /* storage unavailable */ }
    hint.textContent = fine ? 'Drag to look around' : 'Swipe sideways to look around';
    hint.hidden = false; requestAnimationFrame(function () { hint.classList.add('is-on'); });
    hintTimer = setTimeout(hideHint, 7000);
  }
  function hideHint() { clearTimeout(hintTimer); hint.classList.remove('is-on'); setTimeout(function () { hint.hidden = true; }, 300); }
  function usedLook() { if (!look.used) { look.used = true; hideHint(); } }

  function lookAround(cam) {
    var yawDeg = 0, pitchDeg = 0;
    if (fine && !reduce) { yawDeg += (pxs - 0.5) * 2 * CFG.look.yaw; pitchDeg += (0.5 - pys) * 2 * CFG.look.pitch; }
    yawDeg += look.yaw * curStop; pitchDeg += look.pitch * curStop;
    if (!yawDeg && !pitchDeg) return cam.target;
    var f = v3.sub(cam.target, cam.eye), d = v3.len(f); f = v3.norm(f);
    var camRight = v3.norm(v3.cross(f, UP)), screenUp = v3.norm(v3.cross(camRight, f));
    var y = yawDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180;
    var f1 = v3.norm(v3.add(v3.scale(f, Math.cos(y)), v3.scale(camRight, Math.sin(y))));      // positive yaw looks right
    var f2 = v3.norm(v3.add(v3.scale(f1, Math.cos(p)), v3.scale(screenUp, Math.sin(p))));     // positive pitch looks up
    return v3.add(cam.eye, v3.scale(f2, d));
  }

  /* ---- the loop ---------------------------------------------------------- */
  var lastState = '', lastWhere = '', litNow = false, albumOn = null, albumIn = null, lastNow = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min((now - lastNow) / 1000, 0.25); lastNow = now;
    if (document.hidden) return;
    var t = trackT(), cam = cameraAt(t), leg = cam.leg, way = WAY[leg.i];
    pxs = Math.abs(px - pxs) < 0.0006 ? px : lerp(pxs, px, 0.06); pys = Math.abs(py - pys) < 0.0006 ? py : lerp(pys, py, 0.06);
    curStop = stopFactor(t);
    // Leaving a stop eases the look back onto the path; at a stop it holds where you left it.
    if (curStop < 0.99 && !look.dragging) {
      if (reduce) { if (curStop < 0.5) { look.yaw = 0; look.pitch = 0; } }
      else { var k = Math.exp(-dt / FL.easeBack); look.yaw = Math.abs(look.yaw) < 0.05 ? 0 : look.yaw * k; look.pitch = Math.abs(look.pitch) < 0.05 ? 0 : look.pitch * k; }
    }
    var canLook = curStop > 0.5; if (canLook !== stage.classList.contains('can-look')) stage.classList.toggle('can-look', canLook);
    if (!hintShown && way.key === 'spot' && t >= way.arrive && t <= way.at && stage.classList.contains('is-live')) showHint();
    var target = lookAround(cam);
    var q4 = function (v) { return [Math.round(v[0] * 5000) / 5000, Math.round(v[1] * 5000) / 5000, Math.round(v[2] * 5000) / 5000]; };

    // FOV widens a little on the rise, so the ground opens as the camera lifts.
    var fov = baseFov();
    if (RISE && !reduce) {
      var risePos = clamp01((t - (RISE.at - RISE.w)) / RISE.w);
      var afterRise = clamp01((t - RISE.at) / (WAY[Math.min(WAY.indexOf(RISE) + 1, WAY.length - 1)].w || 1));
      fov += CFG.fov.riseWiden * (smooth(risePos) * (1 - smooth(afterRise)));
    }
    if (splat) splat.set({ eye: q4(cam.eye), target: q4(target), fov: Math.round(fov * 20) / 20 });

    // Pins and frames.
    var openIndex = -1, litCount = 0;
    var inRise = RISE && t > RISE.at - RISE.w * 0.45 && t < RISE.at + 0.6;
    // Type and open frames are in front of the world: a pin that falls under
    // them steps back instead of poking through the letters.
    var covers = [];
    var heroNow = parseFloat(hero.dataset.w || '1'), riseNow = parseFloat(riseLine.dataset.w || '0');
    if (heroNow > 0.5) { covers.push(heroTitle.getBoundingClientRect()); covers.push(heroLede.getBoundingClientRect()); }
    if (riseNow > 0.5) covers.push(riseLine.getBoundingClientRect());
    PINS.forEach(function (pin) { if (pin.open) covers.push(pin.frame.querySelector('.frame__inner').getBoundingClientRect()); });
    var covered = function (x, y) {
      for (var k = 0; k < covers.length; k++) { var r = covers[k]; if (x > r.left - 12 && x < r.right + 12 && y > r.top - 12 && y < r.bottom + 12) return true; }
      return false;
    };
    PINS.forEach(function (pin, i) {
      var w = pin.way;
      if (!pin.loaded && t > w.at - w.w - 0.6) loadFrame(pin);
      var s = splat ? splat.project(pin.spot.pin) : { visible: false };
      // Visited is a fact about the walk, not about what is on screen: keep it and the map current even for a pin behind the camera.
      var visited = t >= w.arrive; if (visited !== pin.visited) { pin.visited = visited; pin.btn.classList.toggle('is-visited', visited); MAP_PINS[i].classList.toggle('is-visited', visited); }
      if (!s.visible) { if (!pin.btn.hidden) { pin.btn.hidden = true; pin.frame.classList.remove('is-on'); } if (pin.open) { pin.open = false; pin.btn.classList.remove('is-open'); MAP_PINS[i].classList.remove('is-current'); } return; }
      if (pin.btn.hidden) pin.btn.hidden = false;
      var scale = clamp(0.9 / Math.max(s.z, 0.2), 0.7, 1.35);
      pin.btn.style.transform = 'translate3d(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px,0)';
      pin.btn.style.setProperty('--s', scale.toFixed(3));
      var b = bloomFor(w, t);
      if (Math.abs(b - pin.bloom) > 0.002 || (b > 0) !== (pin.bloom > 0)) {
        pin.bloom = b; pin.frame.style.setProperty('--bloom', b.toFixed(3));
        pin.frame.classList.toggle('is-on', b > 0.01);
      }
      if (b > 0.01) pin.frame.style.transform = 'translate3d(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px,0)';
      var open = b > 0.5; if (open !== pin.open) { pin.open = open; pin.btn.classList.toggle('is-open', open); }
      if (open) openIndex = i;
      var behind = !open && covered(s.x, s.y); if (behind !== pin.behind) { pin.behind = behind; pin.btn.classList.toggle('is-behind', behind); }
      // The label announces the next stop; a pin already visited keeps quiet unless hovered.
      var near = s.z < 0.75 && !open && !visited; if (near !== pin.near) { pin.near = near; pin.btn.classList.toggle('is-near', near); }
      MAP_PINS[i].classList.toggle('is-current', open);
      litCount++;
    });
    if (inRise !== litNow) { litNow = inRise; stage.classList.toggle('is-lit', inRise); }

    // Copy windows against the track. The hero greets and is gone by 0.62 of the first leg.
    var firstW = WAY[1].w;
    var heroW = 1 - smooth((t - firstW * 0.12) / (firstW * 0.5));
    setWindow(hero, clamp01(heroW), reduce ? 0 : -t / firstW * vh * 0.04);
    setWindow(heroScrim, clamp01(heroW), 0);
    setWindow(mark, 1 - clamp01(heroW), null);
    // The rise line: from 0.62 of the rise leg, held into the first stretch of the next.
    var riseFrom = RISE ? RISE.at - RISE.w * 0.34 : Infinity, riseTo = RISE ? RISE.at + 0.55 : -1;
    var riseW = windowAt(t, riseFrom, riseTo, 0.28, 0.25);
    setWindow(riseLine, riseW, reduce ? 0 : (t - riseFrom) * -vh * 0.02);
    setWindow(riseScrim, riseW, 0);
    // The album: finale, from 0.45 of the last leg, holds.
    var albumStart = CLOSE.at - CLOSE.w * 0.55;
    var albumW = smooth((t - albumStart) / (CLOSE.w * 0.4));
    setWindow(album, albumW, null);
    setWindow(albumVeil, clamp01(albumW * 1.6), null);
    var on = albumW > 0.01, inn = albumW > 0.2;
    if (on !== albumOn) { albumOn = on; album.classList.toggle('is-on', on); }
    album.classList.toggle('is-hot', albumW > 0.45);
    map.classList.toggle('is-away', albumW > 0.85);
    if ((albumW > 0.85) !== ctaAtAlbum) { ctaAtAlbum = albumW > 0.85; cta.textContent = ctaAtAlbum ? 'Back to the walk' : ctaLabel; cta.setAttribute('href', ctaAtAlbum ? '#top' : '#album'); }
    if (inn !== albumIn) { albumIn = inn; album.classList.toggle('is-in', inn); }
    // Pins give way to the album at the very end.
    pinsLayer.style.opacity = ((1 - smooth((albumW - 0.6) / 0.4)) * (1 - 0.72 * clamp01(heroW))).toFixed(3);

    // Route map.
    drawMap(cam, t);
    var whereLabel = (t >= way.arrive - 0.001 || leg.u > 0.9) ? way.label : ('→ ' + way.label);
    if (whereLabel !== lastWhere) { lastWhere = whereLabel; mapWhere.textContent = whereLabel; }

    var state = 'leg:' + leg.i + '|u:' + (Math.round(leg.u * 50) / 50).toFixed(2) + '|eye:' + cam.eye.map(function (v) { return v.toFixed(2); }).join(',')
      + '|open:' + openIndex + '|lit:' + (inRise ? 1 : 0) + '|album:' + albumW.toFixed(2) + '|hero:' + clamp01(heroW).toFixed(2)
      + '|look:' + Math.round(look.yaw * curStop) + ',' + Math.round(look.pitch * curStop);
    if (state !== lastState) { lastState = state; stage.setAttribute('data-sc-verify-state', state); }
  }

  /* ---- wiring ------------------------------------------------------------ */
  function relayout() {
    var wasMobile = profile === CFG.mobile;
    layoutTrack();
    if (!glInfo.software) { var nowMobile = isMobile(); if (nowMobile !== wasMobile) { profile = nowMobile ? CFG.mobile : CFG.desktop; if (splat) splat.set({ size: profile.size }); } }
    if (splat) splat.resize();
    lastMapKey = '';
  }
  addEventListener('resize', function () {
    // A phone's URL bar collapsing changes innerHeight; the track must follow so the walk keeps its length.
    relayout();
  }, { passive: true });
  document.addEventListener('visibilitychange', function () { if (splat) splat.pause(document.hidden || !!document.querySelector('dialog[open]')); });

  // Deep link: #album jumps to the end; the page opens at the gate otherwise.
  if (location.hash === '#album') { history.replaceState(null, '', location.pathname + location.search); requestAnimationFrame(function () { scrollTo({ top: TOTAL * vh, behavior: 'instant' }); }); }
  else if (!location.hash && 'scrollRestoration' in history) { /* let the browser restore the walk position on reload */ }

  mountSplat();
  requestAnimationFrame(frame);

  // For the lab and the poster script.
  window.MMNJ_WALK = { config: CFG, waypoints: WAY, spots: SPOTS, photos: PHOTOS, total: TOTAL, cameraAt: cameraAt, splat: function () { return splat; }, flyTo: flyTo, onGround: onGround,
    look: function () { return { yaw: look.yaw, pitch: look.pitch, factor: curStop, dragging: look.dragging }; }, stopFactor: stopFactor,
    frame: { up: UP, fwd: FWD, right: RIGHT }, v3: v3 };
})();
