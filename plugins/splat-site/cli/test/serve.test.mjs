// splatsite/cli/test/serve.test.mjs — fast (no browser) tests for lib/serve.mjs: path
// containment against traversal, malformed-request resilience, and port-in-use rejection.
import test from "node:test"; import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { startServer } from "../lib/serve.mjs";

function get(url, rawPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.get({ hostname: u.hostname, port: u.port, path: rawPath }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
  });
}

test("serve: encoded '..' traversal to a sibling folder is refused (404), not served", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "serve-"));
  const root = path.join(base, "site"); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "index.html"), "<h1>ok</h1>");
  const sibling = path.join(base, "site-secret"); fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(sibling, "secret.txt"), "top secret");

  const srv = await startServer(root, 0);
  try {
    const r = await get(srv.url, "/..%2fsite-secret%2fsecret.txt");
    assert.equal(r.status, 404);
    assert.doesNotMatch(r.body, /top secret/);
  } finally { await srv.close(); }
});

test("serve: a malformed (bare '%') request path answers 400 and the server keeps serving", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "serve-"));
  const root = path.join(base, "site"); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "index.html"), "<h1>ok</h1>");

  const srv = await startServer(root, 0);
  try {
    const bad = await get(srv.url, "/%");
    assert.equal(bad.status, 400);
    const ok = await get(srv.url, "/index.html");
    assert.equal(ok.status, 200);
    assert.match(ok.body, /<h1>ok<\/h1>/);
  } finally { await srv.close(); }
});

test("serve: a read-stream error (unreadable file) doesn't crash the server", { skip: process.getuid && process.getuid() === 0 ? "cannot make a file unreadable as root" : false }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "serve-"));
  const root = path.join(base, "site"); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "index.html"), "<h1>ok</h1>");
  const locked = path.join(root, "locked.bin");
  fs.writeFileSync(locked, "secret bytes");
  fs.chmodSync(locked, 0);

  // Fires a request whose response the server aborts mid-stream (no clean "end"); resolves on
  // whatever signal comes first instead of hanging forever waiting for one that never fires.
  const getTolerant = (url, rawPath) => new Promise((resolve) => {
    const u = new URL(url);
    const req = http.get({ hostname: u.hostname, port: u.port, path: rawPath }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve({ status: res.statusCode }));
      res.on("close", () => resolve({ status: res.statusCode }));
      res.on("error", () => resolve({ status: res.statusCode }));
    });
    req.on("error", () => resolve({ status: null }));
  });

  const srv = await startServer(root, 0);
  try {
    // The response headers (200) are written before the read fails, so the connection is
    // destroyed mid-stream -- the important thing is that the server is still alive afterward
    // (the stream's "error" handler calls res.destroy() instead of letting it hang or crash).
    await getTolerant(srv.url, "/locked.bin");
    const ok = await get(srv.url, "/index.html");
    assert.equal(ok.status, 200);
    assert.match(ok.body, /<h1>ok<\/h1>/);
  } finally {
    fs.chmodSync(locked, 0o644);
    await srv.close();
  }
});

test("serve: startServer rejects when the port is already in use", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "serve-"));
  const root = path.join(base, "site"); fs.mkdirSync(root);
  const first = await startServer(root, 0);
  const busyPort = Number(new URL(first.url).port);
  try {
    await assert.rejects(startServer(root, busyPort), (e) => e.code === "EADDRINUSE");
  } finally { await first.close(); }
});

test("a doubled-slash path is served, not a 500", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "splatsite-serve-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>ok</title>");
  const s = await startServer(dir, 0);
  try {
    // built as a string: new URL("//", base) hits the same protocol-relative quirk this guards
    const r = await fetch(s.url + "/");
    assert.equal(r.status, 200);
    assert.match(await r.text(), /ok/);
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
