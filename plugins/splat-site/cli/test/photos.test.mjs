import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import sharp from "sharp";
import { processPhotos } from "../lib/photos.mjs";

test("photos are resized to web and thumb sizes", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ph-")); fs.mkdirSync(path.join(d, "src"));
  await sharp({ create: { width: 3000, height: 4000, channels: 3, background: "#456" } }).jpeg().toFile(path.join(d, "src", "a.jpg"));
  const out = await processPhotos(path.join(d, "src"), path.join(d, "out"), ["a.jpg"]);
  assert.deepEqual(out, [{ file: "a.jpg", w: 1200, h: 1600 }]);
  const thumb = await sharp(path.join(d, "out", "a-thumb.jpg")).metadata(); assert.equal(thumb.height, 640);
  await assert.rejects(processPhotos(path.join(d, "src"), path.join(d, "out"), ["missing.jpg"]), (e) => e.code === 2);
});

test("processes multiple files including dotted base names", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ph-")); fs.mkdirSync(path.join(d, "src"));
  await sharp({ create: { width: 3000, height: 4000, channels: 3, background: "#456" } }).jpeg().toFile(path.join(d, "src", "holiday.v2.jpg"));
  await sharp({ create: { width: 2000, height: 3000, channels: 3, background: "#789" } }).jpeg().toFile(path.join(d, "src", "beach.jpg"));
  const out = await processPhotos(path.join(d, "src"), path.join(d, "out"), ["holiday.v2.jpg", "beach.jpg"]);
  assert.equal(out.length, 2);
  assert.equal(out[0].file, "holiday.v2.jpg");
  assert.equal(out[1].file, "beach.jpg");
  assert(fs.existsSync(path.join(d, "out", "holiday.v2.jpg")));
  assert(fs.existsSync(path.join(d, "out", "holiday.v2-thumb.jpg")));
  assert(fs.existsSync(path.join(d, "out", "beach.jpg")));
  assert(fs.existsSync(path.join(d, "out", "beach-thumb.jpg")));
});

test("rejects non-image files with code 1", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ph-")); fs.mkdirSync(path.join(d, "src"));
  fs.writeFileSync(path.join(d, "src", "bad.jpg"), "not an image");
  await assert.rejects(processPhotos(path.join(d, "src"), path.join(d, "out"), ["bad.jpg"]), (e) => e.code === 1);
});
