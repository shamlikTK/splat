// splatsite/cli/lib/photos.mjs — Process photos to web and thumbnail sizes with EXIF orientation.
// Exports: processPhotos(srcDir, outDir, files, {web=1600, thumb=640}) -> Promise<Array<{file,w,h}>>

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { fail } from "./cli-util.mjs";

export async function processPhotos(srcDir, outDir, files, { web = 1600, thumb = 640 } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const out = [];
  for (const f of files) {
    const src = path.join(srcDir, f);
    if (!fs.existsSync(src)) {
      throw fail(`photo "${f}" listed in the manifest is not in ${srcDir} — check the file name in manifest.json or copy the photo into that folder`);
    }
    const ext = path.extname(f), base = f.slice(0, -ext.length);
    try {
      const w = await sharp(src).rotate().resize({ width: web, height: web, fit: "inside", withoutEnlargement: true }).toFile(path.join(outDir, f));
      await sharp(src).rotate().resize({ width: thumb, height: thumb, fit: "inside", withoutEnlargement: true }).toFile(path.join(outDir, `${base}-thumb${ext}`));
      out.push({ file: f, w: w.width, h: w.height });
    } catch (e) {
      throw fail(`could not process photo "${f}": ${e.message} — is it a valid JPEG/PNG?`, 1);
    }
  }
  return out;
}
