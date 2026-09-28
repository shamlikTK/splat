// splatsite/cli/test/fixtures/make-scene.mjs — test fixture generator.
// Exports: makeScene(dir) -> Promise<dir>
// Writes a tiny but valid scene folder (as `splatsite convert` would produce): a synthetic
// 2,000-splat PLY converted to three SOG tiers via splat-transform, cameras.json (5 cameras
// along +z), bounds.json, a one-spot manifest.json, and one generated photo under pics/.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Resolve the splat-transform binary relative to the package root (not process.cwd()) so the
// fixture works whether tests are run from splatsite/cli or from the repo root.
const SPLAT_TRANSFORM = fileURLToPath(new URL("../../node_modules/.bin/splat-transform", import.meta.url));

export async function makeScene(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const n = 2000;
  const props = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\n${props.map((p) => `property float ${p}`).join("\n")}\nend_header\n`;
  const buf = Buffer.alloc(n * props.length * 4);
  let o = 0;
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const v = [rnd() * 2 - 1, rnd() * 1 - 0.8, rnd() * 4, rnd(), rnd(), rnd(), 2, -4, -4, -4, 1, 0, 0, 0];
    for (const x of v) { buf.writeFloatLE(x, o); o += 4; }
  }
  fs.writeFileSync(path.join(dir, "tiny.ply"), Buffer.concat([Buffer.from(header), buf]));

  for (const [name, dec] of [["capture", null], ["capture-mobile", "50%"], ["capture-lite", "25%"]]) {
    if (dec) {
      execFileSync(SPLAT_TRANSFORM, ["-g", "cpu", "-w", path.join(dir, "tiny.ply"), "--decimate-adaptive", dec, path.join(dir, `${name}.ply`)], { stdio: "ignore" });
      execFileSync(SPLAT_TRANSFORM, ["-g", "cpu", "-w", path.join(dir, `${name}.ply`), path.join(dir, `${name}.sog`)], { stdio: "ignore" });
    } else {
      execFileSync(SPLAT_TRANSFORM, ["-g", "cpu", "-w", path.join(dir, "tiny.ply"), path.join(dir, `${name}.sog`)], { stdio: "ignore" });
    }
  }

  const cams = Array.from({ length: 5 }, (_, i) => ({ name: `frame_${i}.jpg`, c2w: [[1, 0, 0, 0], [0, 1, 0, -0.2], [0, 0, 1, i * 0.8], [0, 0, 0, 1]] }));
  fs.writeFileSync(path.join(dir, "cameras.json"), JSON.stringify({ convention: "opencv_c2w", up: [0, -1, 0], cameras: cams }));
  fs.writeFileSync(path.join(dir, "bounds.json"), JSON.stringify({ center: [0, -0.3, 2], radius: 2.2, count: n }));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    title: "Tiny", description: "d", mark: "Tiny", hero: { a: "Tiny", b: "scene" }, lede: "l", riseLine: "r", albumTitle: "Album", colophon: "c", morePages: [],
    posters: { desktop: "posters/desktop.jpg", mobile: "posters/mobile.jpg", alt: "poster" }, capture: "capture.sog", photosDir: "photos",
    theme: { accent: "#00AAFF", ink: "#FFFFFF", ground: "#101010" },
    frame: { up: [0, -1, 0], fwd: [0, 0, 1], right: [-1, 0, 0], origin: [0, 0, 0], fwd0: 0, fwd1: 3.2 }, ground: { point: [0, 0, 0] },
    config: { axis: { back: 0.5 }, eyeHeight: 0.25, standBack: 0.3, desktop: { file: "capture.sog", lod: false, maxDpr: 1.5 }, mobile: { file: "capture-mobile.sog", lod: false, maxDpr: 1.25 }, software: { file: "capture-lite.sog", lod: false, maxDpr: 1 }, full: "capture.sog", viewer: { file: "capture.sog", fileMobile: "capture-mobile.sog", fileLite: "capture-lite.sog", lod: false, size: 1 } },
    poses: { gate: { eye: [0, -0.2, 0], target: { t: 0.5, a: 0, h: 0.2 } }, rise: { eye: { t: 0.5, a: 0, h: 2 }, target: { t: 0.5, a: 0, h: 0 } }, close: { eye: { t: -0.3, a: 0, h: 1 }, target: { t: 0.5, a: 0, h: 0 } } },
    spots: [{ label: "The middle", pin: { t: 0.5, a: 0.2, h: 0.1 }, photos: [{ file: "p1.jpg", title: "Photo 1", w: 480, h: 640 }] }],
  }, null, 1));
  fs.mkdirSync(path.join(dir, "pics"), { recursive: true });
  await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#a63" } }).jpeg().toFile(path.join(dir, "pics", "p1.jpg"));
  return dir;
}
