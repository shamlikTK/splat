// splatsite/cli/lib/manifest.mjs — Load and manipulate scene manifests, frame coordinates, and page config.
// Exports: loadManifest(path) -> manifest, frameOf(m) -> frame, resolve(pos, F, groundPoint) -> [x,y,z],
// albumMarkup(m, F, groundPoint) -> string, pageConfig(m, F, groundPoint) -> object, esc(s) -> string

import fs from "node:fs";
import path from "node:path";
import { fail } from "./cli-util.mjs";

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const r4 = (v) => Math.round(v * 10000) / 10000;
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
// a pose/pin position is either a raw [x, y, z] array (what `splatsite convert` emits) or a
// {t, a, h} object (t required; a and h default to 0 — see resolve() below).
const isPos = (v) => isVec3(v) || (v !== null && typeof v === "object" && !Array.isArray(v) && isNum(v.t));

export function loadManifest(file) {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw fail(`cannot read manifest ${file}: ${e.message}`);
  }
  for (const k of ["title", "frame", "poses", "spots", "capture"]) {
    if (!(k in m)) throw fail(`manifest ${file} lacks "${k}" — run 'splatsite convert' to generate a starter manifest, then edit it`);
  }
  if (!Array.isArray(m.spots)) throw fail(`manifest ${file}: "spots" must be an array — pass [] if there are no spots yet, or an array of spot objects`);
  if (!isVec3(m.frame?.up) || !isVec3(m.frame?.fwd)) {
    throw fail(`manifest ${file}: "frame.up" and "frame.fwd" must each be a [x, y, z] array of 3 numbers — run 'splatsite convert' to regenerate the frame, or see docs/manifest.md`);
  }
  for (const k of ["gate", "rise", "close"]) {
    const eye = m.poses[k]?.eye, target = m.poses[k]?.target;
    if (!isPos(eye) || !isPos(target)) {
      throw fail(`manifest poses.${k} needs "eye" and "target", each a [x, y, z] array or a {t, a, h} object — see docs/manifest.md`);
    }
  }
  m.photosDir ??= "photos";
  m.theme ??= {};
  m.config ??= {};
  m.hero ??= { a: m.title, b: "" };
  m.posters ??= {};
  m.morePages ??= [];
  m.spots.forEach((s, i) => {
    if (!s.pin) throw fail(`spot ${i} (${s.label || "unnamed"}) has no pin`);
    if (!s.photos?.length) throw fail(`spot ${i} (${s.label || "unnamed"}) has no photos`);
  });
  return m;
}

export function frameOf(m) {
  const f = m.frame;
  const up = norm(f.up);
  const fwd = norm(f.fwd);
  const right = f.right ? norm(f.right) : norm(cross(up, fwd));
  return { up, fwd, right, origin: f.origin || [0, 0, 0], fwd0: f.fwd0 ?? 0, fwd1: f.fwd1 ?? 1 };
}

// { t, a, h } -> world: t along the path (0 near end, 1 far end), a across (right), h above the ground plane.
export function resolve(pos, F, groundPoint) {
  if (Array.isArray(pos)) return pos.map(r4);
  const fv = F.fwd0 + (F.fwd1 - F.fwd0) * pos.t;
  const p = [0, 1, 2].map((k) => F.origin[k] + F.fwd[k] * fv + F.right[k] * (pos.a || 0));
  const d = dot([0, 1, 2].map((k) => p[k] - groundPoint[k]), F.up);
  return [0, 1, 2].map((k) => r4(p[k] - F.up[k] * d + F.up[k] * (pos.h || 0)));
}

export function albumMarkup(m, F, groundPoint) {
  return m.spots.map((s, si) => {
    const pin = resolve(s.pin, F, groundPoint);
    const eye = s.eye ? resolve(s.eye, F, groundPoint) : null;
    const single = s.photos.length === 1;
    const attrs = `data-pin="${pin.join(" ")}"${eye ? ` data-eye="${eye.join(" ")}"` : ""} data-label="${esc(s.label)}" data-i="${si}"`;
    const shots = s.photos.map((p) => {
      const base = path.posix.join(m.photosDir, p.file);
      const thumb = base.replace(/(\.[a-z0-9]+)$/i, "-thumb$1");
      const cap = single ? `<strong class="shot__title">${esc(p.title)}</strong> <span class="shot__spot">${esc(s.label)}</span>` : `<strong class="shot__title">${esc(p.title)}</strong>`;
      return `        <li class="shot"><figure><a class="shot__link" href="${esc(base)}"><img src="${esc(thumb)}" width="${p.w || 480}" height="${p.h || 640}" loading="lazy" decoding="async" alt="${esc(p.alt || p.title)}"></a><figcaption>${cap}</figcaption></figure></li>`;
    }).join("\n");
    const head = single ? "" : `        <h3 class="spot__name"><a class="spot__open" href="${esc(path.posix.join(m.photosDir, s.photos[0].file))}">${esc(s.label)}</a> <span class="spot__count">${s.photos.length} photos</span></h3>\n`;
    return `      <li class="spot${single ? " spot--single" : ""}" ${attrs}>\n${head}        <ol class="spot__photos">\n${shots}\n        </ol>\n      </li>`;
  }).join("\n") + "\n";
}

export function pageConfig(m, F, groundPoint) {
  return Object.assign({}, m.config, {
    file: m.capture,
    frame: { up: F.up.map(r4), fwd: F.fwd.map(r4) },
    ground: { point: groundPoint.map(r4) },
    axis: Object.assign({ origin: F.origin.map(r4) }, m.config.axis || {}),
    poses: Object.fromEntries(Object.entries(m.poses).map(([k, v]) => [k, { eye: resolve(v.eye, F, groundPoint), target: resolve(v.target, F, groundPoint) }])),
  });
}
