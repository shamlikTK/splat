/* ============================================================================
   splat.js: the venue renderer, now Spark 2.1 on three.js reading SOG files.

   Same contract as the previous bespoke WebGL2 renderer, so walk.js and
   viewer.js are untouched:

     VenueSplat.create(canvas, opts) -> { state, load(url), project(p), on(ev, fn),
                                          set(o), pause(p), resize(), snapshot(), destroy() }
     VenueSplat.probe() -> { supported, software, renderer }
     events: 'progress' (0..1), 'ready' (count), 'paint' (first frame with splats),
             'sample' (Uint8Array of 32-byte rows: pos f32x3, scale f32x3, rgba u8x4,
             rot u8x4 — a strided sample of the capture the route map draws its plan from)

   Conventions kept: the world is the capture's native frame (3DGS files, y down);
   the camera is placed from `eye`, `target` and the world `up` (the fitted ground
   normal), so the manifests' poses are used as they are. `size` (the old dilation
   knob for sparse budgets) is accepted and ignored: SOG files carry every splat
   with full spherical harmonics and Spark's level-of-detail does the budgeting.
   ========================================================================== */
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

(function (global) {
  'use strict';
  var ROW = 32;

  function create(canvas, opts) {
    opts = opts || {};
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: true, premultipliedAlpha: true,
        preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    } catch (e) { console.error('[splat]', e); return null; }
    if (!renderer.getContext() || !renderer.capabilities.isWebGL2) { renderer.dispose(); return null; }
    renderer.setClearColor(0x000000, 0);

    var NEAR = opts.near || 0.02, FAR = opts.far || 60;
    var state = {
      count: 0, drawCount: 0, ready: false, painted: false,
      eye: opts.eye || [0, 0, -1], target: opts.target || [0, 0, 1], up: opts.up || [0, -1, 0],
      fov: opts.fov || 50, roll: 0, alpha: 1, size: opts.size || 1, lowpass: 0,
      dpr: 1, w: 1, h: 1, cssW: 1, cssH: 1, dirty: true, paused: false
    };
    var listeners = { progress: [], ready: [], paint: [], sample: [] };
    function emit(n, v) { listeners[n].forEach(function (f) { f(v); }); }

    var scene = new THREE.Scene();
    var spark = new SparkRenderer({ renderer: renderer, maxPixelRadius: opts.maxPixelRadius || 512 });
    scene.add(spark);
    var camera = new THREE.PerspectiveCamera(state.fov, 1, NEAR, FAR);
    var mesh = null;

    var V = { eye: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(), p: new THREE.Vector3() };
    function applyCamera() {
      V.eye.fromArray(state.eye); V.target.fromArray(state.target); V.up.fromArray(state.up).normalize();
      camera.up.copy(V.up);
      camera.position.copy(V.eye);
      camera.lookAt(V.target);
      if (state.roll) camera.rotateZ(state.roll * Math.PI / 180);
      if (camera.fov !== state.fov) { camera.fov = state.fov; camera.updateProjectionMatrix(); }
      camera.updateMatrixWorld(true);
    }

    function resize() {
      var r = canvas.getBoundingClientRect();
      var dpr = Math.min(global.devicePixelRatio || 1, opts.maxDpr || 1.5);
      var cssW = Math.max(1, r.width), cssH = Math.max(1, r.height);
      var w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
      state.cssW = cssW; state.cssH = cssH;
      if (w === state.w && h === state.h && dpr === state.dpr) return;
      state.w = w; state.h = h; state.dpr = dpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(cssW, cssH, false);
      camera.aspect = cssW / cssH; camera.updateProjectionMatrix();
      touch();
    }

    // Spark sorts asynchronously (a worker hands back a new draw order a few frames
    // later), so a view change is followed by a burst of frames until the order has
    // landed, and the first seconds after a load render continuously; then the loop
    // idles until the next change. Both windows are generous because software
    // rasterisers and phones can take a second or two per sort.
    // Two windows: a short burst after every camera/setting change (this is what `dirty`
    // reports), and a longer one after a load so the first sort and any streamed-in
    // splats get drawn without the page having to poke the renderer.
    var activeUntil = 0, loadUntil = 0, readyAt = Infinity;
    function touch(ms) { state.dirty = true; activeUntil = Math.max(activeUntil, performance.now() + (ms || 2000)); }
    function draw() {
      applyCamera();
      if (mesh) mesh.opacity = state.alpha;
      renderer.render(scene, camera);
      // `dirty` stays true while the post-change burst is still running, so callers
      // (the lab's "settled" wait) know when the picture has actually stopped changing.
      state.dirty = performance.now() < activeUntil;
      if (!state.painted && mesh && mesh.isInitialized && state.count > 0 && performance.now() - readyAt > 250) { state.painted = true; emit('paint', true); }
    }
    var running = true;
    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      if (state.paused) return;
      if (state.dirty || now < activeUntil || now < loadUntil || (mesh && !state.painted)) draw();
    }
    requestAnimationFrame(frame);

    // The route map wants a plan of the venue: a strided sample of splats in the old row layout.
    function makeSample(n) {
      var total = mesh.numSplats, want = Math.min(n, total), stride = Math.max(1, Math.floor(total / want));
      var out = new Uint8Array(want * ROW), dv = new DataView(out.buffer), j = 0;
      mesh.forEachSplat(function (index, center, scales, quaternion, opacity, color) {
        if (index % stride !== 0 || j >= want) return;
        var o = j * ROW;
        dv.setFloat32(o, center.x, true); dv.setFloat32(o + 4, center.y, true); dv.setFloat32(o + 8, center.z, true);
        dv.setFloat32(o + 12, scales.x, true); dv.setFloat32(o + 16, scales.y, true); dv.setFloat32(o + 20, scales.z, true);
        out[o + 24] = Math.max(0, Math.min(255, Math.round(color.r * 255)));
        out[o + 25] = Math.max(0, Math.min(255, Math.round(color.g * 255)));
        out[o + 26] = Math.max(0, Math.min(255, Math.round(color.b * 255)));
        out[o + 27] = Math.max(0, Math.min(255, Math.round(opacity * 255)));
        out[o + 28] = Math.round(quaternion.w * 127 + 128); out[o + 29] = Math.round(quaternion.x * 127 + 128);
        out[o + 30] = Math.round(quaternion.y * 127 + 128); out[o + 31] = Math.round(quaternion.z * 127 + 128);
        j++;
      });
      return j === want ? out : out.subarray(0, j * ROW);
    }

    function load(url) {
      if (mesh) { scene.remove(mesh); mesh.dispose && mesh.dispose(); mesh = null; }
      state.ready = false; state.painted = false; state.count = 0; readyAt = Infinity;
      var m = new SplatMesh({
        url: url,
        lod: !!opts.lod,
        onProgress: function (e) { if (e && e.total) emit('progress', Math.min(1, e.loaded / e.total)); }
      });
      mesh = m;
      scene.add(m);
      return m.initialized.then(function () {
        if (mesh !== m) return;
        state.count = state.drawCount = m.numSplats; readyAt = performance.now();
        emit('progress', 1);
        state.ready = true; emit('ready', state.count);
        loadUntil = performance.now() + 10000; touch();
        try { emit('sample', makeSample(opts.sample || 8192)); } catch (e) { console.warn('[splat] sample failed', e); }
      }).catch(function (err) { if (mesh === m) { scene.remove(m); mesh = null; } throw err; });
    }

    // World point -> CSS pixels on the canvas; `z` is camera depth (positive in front).
    function project(p) {
      applyCamera();
      V.p.set(p[0], p[1], p[2]);
      var cz = -V.p.clone().applyMatrix4(camera.matrixWorldInverse).z;
      if (cz < NEAR) return { x: 0, y: 0, z: cz, visible: false };
      V.p.project(camera);
      var nx = V.p.x, ny = V.p.y;
      return { x: (nx * 0.5 + 0.5) * state.cssW, y: (0.5 - ny * 0.5) * state.cssH, z: cz,
        visible: nx > -1.3 && nx < 1.3 && ny > -1.3 && ny < 1.3 };
    }

    var ro = ('ResizeObserver' in global) ? new ResizeObserver(function () { resize(); }) : null;
    if (ro) ro.observe(canvas);
    resize();

    var api = {
      state: state,
      load: load,
      project: project,
      three: { renderer: renderer, scene: scene, camera: camera, spark: spark, mesh: function () { return mesh; } },
      on: function (n, f) { if (listeners[n]) listeners[n].push(f); return api; },
      set: function (o) {
        var changed = false;
        for (var k in o) {
          if (!o.hasOwnProperty(k)) continue;
          var v = o[k];
          if (Array.isArray(v)) {
            var cur = state[k];
            if (!cur || cur[0] !== v[0] || cur[1] !== v[1] || cur[2] !== v[2]) { state[k] = v; changed = true; }
            continue;
          }
          if (state[k] !== v) { state[k] = v; changed = true; }
        }
        if (changed) touch();
        return api;
      },
      pause: function (p) { p = !!p; if (p === state.paused) return api; state.paused = p; if (!p) touch(); return api; },
      resize: resize,
      // Synchronous draw + read for poster capture. Callers should let a few frames pass
      // after a camera change so Spark's sort has settled.
      snapshot: function (type, quality) { draw(); draw(); return canvas.toDataURL(type || 'image/png', quality); },
      destroy: function () { running = false; if (ro) ro.disconnect(); if (mesh) { scene.remove(mesh); mesh.dispose && mesh.dispose(); } renderer.dispose(); }
    };
    return api;
  }

  // Renderer probe: WebGL2 present, and is it a software rasteriser (SwiftShader,
  // llvmpipe...)? The page picks the lighter capture on such machines.
  function probe() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2');
      if (!gl) return { supported: false, software: false, renderer: '' };
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      var r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
      var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      return { supported: true, software: /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(r), renderer: r };
    } catch (e) { return { supported: false, software: false, renderer: '' }; }
  }
  global.VenueSplat = { create: create, probe: probe, supported: function () { return probe().supported; } };
})(window);
