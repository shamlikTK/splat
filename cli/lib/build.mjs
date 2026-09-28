// splatsite/cli/lib/build.mjs — assembles a static photo-walk site from a scene folder
// (manifest.json + SOG capture tiers + posters, as written by `splatsite convert`) and a
// folder of source photos.
// Exports:
//   buildSite({ scene, photos, out }) -> Promise<{ out, spots, photos }>
//     Copies the template, copies capture/poster assets into out/assets (rewriting the
//     manifest's paths to match), resizes photos into out/photos via processPhotos, writes
//     theme.css from the manifest's theme, and renders template.html into out/index.html.
//     Refuses (exit 2) if the scene still has a `sog-pending` marker (see lib/finish.mjs) —
//     run `splatsite finish <scene>` first.
//   main(argv) -> Promise<number>
//     CLI entry point for `splatsite build <scene> --photos DIR [--out ./site]`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, frameOf, albumMarkup, pageConfig, esc } from "./manifest.mjs";
import { processPhotos } from "./photos.mjs";
import { parseArgs, fail } from "./cli-util.mjs";

const TEMPLATE = fileURLToPath(new URL("../template/", import.meta.url));

export async function buildSite({ scene, photos, out }) {
  if (fs.existsSync(path.join(scene, "sog-pending"))) throw fail("scene has pending SOG encoding — run 'splatsite convert' again (or 'splatsite finish <scene>') to finish it", 2);
  for (const f of ["manifest.json", "capture.sog"]) if (!fs.existsSync(path.join(scene, f))) throw fail(`${scene}/${f} not found — is this a folder written by 'splatsite convert'?`);
  const m = loadManifest(path.join(scene, "manifest.json")); const F = frameOf(m); const ground = m.ground?.point || F.origin;
  // guard the wipe below: refuse an --out that would delete the scene, the photos, or the caller's cwd
  const outAbs = path.resolve(out), sceneAbs = path.resolve(scene), photosAbs = path.resolve(photos);
  if (!fs.existsSync(photosAbs) || !fs.statSync(photosAbs).isDirectory()) throw fail(`--photos ${photos} is not a directory — pass the folder of source photos`);
  if (outAbs === sceneAbs) throw fail(`--out ${out} is the same folder as the scene — building would delete the scene; pass a different --out`);
  if (sceneAbs.startsWith(outAbs + path.sep)) throw fail(`scene ${scene} is inside --out ${out} — building would delete the scene; pass an --out outside the scene folder`);
  if (outAbs === photosAbs) throw fail(`--out ${out} is the same folder as --photos ${photos} — building would delete the photos; pass a different --out`);
  if (photosAbs.startsWith(outAbs + path.sep)) throw fail(`--photos ${photos} is inside --out ${out} — building would delete the photos; pass an --out outside the photos folder`);
  if (outAbs === process.cwd()) throw fail(`--out ${out} is the current directory — building would delete everything in it; pass a subdirectory as --out`);
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, "assets"), { recursive: true });
  for (const f of fs.readdirSync(TEMPLATE)) if (f !== "template.html") fs.cpSync(path.join(TEMPLATE, f), path.join(out, f), { recursive: true });
  // captures and posters -> assets/, manifest paths rewritten to assets/<name>; memoized so each
  // source file (e.g. capture.sog reused as both "full" and "desktop") is copied only once.
  const copied = new Map();
  const asset = (p, kind = "capture file") => {
    if (!p) return p;
    const src = path.join(scene, p);
    if (copied.has(src)) return copied.get(src);
    if (!fs.existsSync(src)) throw fail(`${kind} ${p} referenced by the manifest is missing in ${scene}`);
    const dst = path.posix.join("assets", path.basename(p));
    fs.copyFileSync(src, path.join(out, dst));
    copied.set(src, dst);
    return dst;
  };
  m.capture = asset(m.capture); for (const k of ["desktop", "mobile", "software"]) if (m.config[k]?.file) m.config[k].file = asset(m.config[k].file);
  if (m.config.full) m.config.full = asset(m.config.full); for (const k of ["file", "fileMobile", "fileLite"]) if (m.config.viewer?.[k]) m.config.viewer[k] = asset(m.config.viewer[k]);
  const hasPosters = m.posters?.desktop && m.posters?.mobile && fs.existsSync(path.join(scene, m.posters.desktop)) && fs.existsSync(path.join(scene, m.posters.mobile));
  if (hasPosters) { m.posters.desktop = asset(m.posters.desktop, "poster"); m.posters.mobile = asset(m.posters.mobile, "poster"); }
  else { m.posters = { desktop: "assets/poster-desktop.svg", mobile: "assets/poster-mobile.svg", alt: m.posters?.alt || "" }; for (const p of ["poster-desktop.svg", "poster-mobile.svg"]) fs.writeFileSync(path.join(out, "assets", p), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="${esc(m.theme.ground || "#0A0F0C")}"/></svg>`); }
  // photos
  const files = [...new Set(m.spots.flatMap((s) => s.photos.map((p) => p.file)))];
  const sizes = await processPhotos(photos, path.join(out, m.photosDir), files);
  for (const s of m.spots) for (const p of s.photos) { const z = sizes.find((x) => x.file === p.file); if (z) { p.w = z.w; p.h = z.h; } }
  // theme
  const t = m.theme || {}; fs.writeFileSync(path.join(out, "theme.css"), `:root{${t.accent ? `--sc-accent:${t.accent};` : ""}${t.ink ? `--sc-ink:${t.ink};` : ""}${t.ground ? `--sc-canvas:${t.ground};` : ""}}\n`);
  // page
  const others = m.morePages.map((p) => `<a href="${esc(p.href)}">${esc(p.label)}</a>`);
  const vars = { name: "index", title: esc(m.title), description: esc(m.description || m.title), mark: esc(m.mark || m.title), heroA: esc(m.hero.a), heroB: esc(m.hero.b || ""), lede: esc(m.lede || ""), riseLine: esc(m.riseLine || ""),
    albumTitle: esc(m.albumTitle || "The album"), colophon: esc(m.colophon || ""), morePages: others.length ? `    <p class="album__more">Also walk: ${others.join(", ")}.</p>\n` : "",
    posterDesktop: m.posters.desktop, posterMobile: m.posters.mobile, posterAlt: esc(m.posters.alt || ""), viewerFile: m.config.viewer?.file || m.capture,
    themeColor: esc(t.ground || "#0A0F0C"),
    config: JSON.stringify(pageConfig(m, F, ground)).replace(/</g, "\\u003c"), album: albumMarkup(m, F, ground) };
  const html = fs.readFileSync(path.join(TEMPLATE, "template.html"), "utf8").replace(/{{(\w+)}}/g, (_, k) => { if (!(k in vars)) throw new Error(`template needs {{${k}}}`); return vars[k]; });
  fs.writeFileSync(path.join(out, "index.html"), html);
  return { out, spots: m.spots.length, photos: files.length };
}

export async function main(argv) {
  const a = parseArgs(argv); const scene = a._[0]; if (!scene || typeof a.photos !== "string") throw fail("usage: splatsite build <scene> --photos DIR [--out ./site]");
  const r = await buildSite({ scene: path.resolve(scene), photos: path.resolve(a.photos), out: path.resolve(a.out || "site") });
  console.log(`built ${r.out}: ${r.spots} spots, ${r.photos} photos. Preview: splatsite serve ${a.out || "site"}`); return 0;
}
