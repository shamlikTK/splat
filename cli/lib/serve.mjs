// splatsite/cli/lib/serve.mjs — minimal static file server for previewing a built site.
// Exports:
//   startServer(dir, port = 4500, host = "127.0.0.1") -> Promise<{ url, close() }>
//     Serves `dir` over plain HTTP (no Range support needed for this use case) with MIME
//     types for the file extensions a built site uses (.html/.js/.mjs/.css/.json/.sog/.jpg/
//     .jpeg/.png/.svg/.webp/.woff2). Binds `host` (default 127.0.0.1 — loopback-only; pass
//     "0.0.0.0" to opt in to reaching it from a container host), but the returned `url` always
//     points at localhost. `port = 0` lets the OS pick a free port (used by tests and `check`).
//     Paths are resolved and confined to `dir` (no escaping via `..` or encoded traversal); a
//     malformed request path answers 400 instead of crashing the process, and any other
//     per-request failure answers 500 — the handler never throws.
//     The returned promise rejects if the server fails to start (e.g. `EADDRINUSE`).
//   main(argv) -> Promise<never>
//     CLI entry point for `splatsite serve <site> [--port 4500] [--host 0.0.0.0]`; runs until
//     interrupted. Refuses up front (exit 2) when `<site>` is missing/not a directory, has no
//     index.html, `--port` is not an integer in 1-65535, or the port is already in use.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { parseArgs, fail } from "./cli-util.mjs";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".sog": "application/octet-stream", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2" };

export function startServer(dir, port = 4500, host = "127.0.0.1") {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    try {
      let p;
      try {
        // Concatenate rather than resolve against a base: a request path that begins with two
        // slashes ("//", or "//assets/x") is read as a protocol-relative authority by the URL
        // parser and throws, which surfaced as a 500 on a plain "//" request.
        p = decodeURIComponent(new URL("http://x" + (req.url.startsWith("/") ? req.url : "/" + req.url)).pathname);
      } catch (e) {
        if (e instanceof URIError) { res.writeHead(400); res.end("bad request"); return; }
        throw e;
      }
      if (p.endsWith("/")) p += "index.html";
      // Resolve (not join) so ".." segments are normalised before the containment check —
      // a decoded path that climbs above `root` (e.g. "/../secret/x") must 404, not escape it.
      const file = path.resolve(root, "." + p);
      const inRoot = file === root || file.startsWith(root + path.sep);
      if (!inRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
      fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
    } catch {
      try { res.writeHead(500); res.end("internal error"); } catch { /* response already sent/closed */ }
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({ url: `http://localhost:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) }));
  });
}

export async function main(argv) {
  const a = parseArgs(argv);
  const dir = a._[0] || "site";
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw fail(`${dir} is not a directory — build a site first with 'splatsite build <scene> --photos DIR --out ${dir}'`, 2);
  if (!fs.existsSync(path.join(abs, "index.html"))) throw fail(`${abs}/index.html not found — is this a folder written by 'splatsite build'?`, 2);
  let port = 4500;
  if (a.port !== undefined) {
    const n = Number(a.port);
    if (typeof a.port !== "string" || !/^\d+$/.test(a.port) || !Number.isInteger(n) || n < 1 || n > 65535) throw fail(`--port ${a.port} is not a valid port — pass an integer between 1 and 65535`, 2);
    port = n;
  }
  const host = a.host === undefined ? "127.0.0.1" : String(a.host);
  let s;
  try {
    s = await startServer(dir, port, host);
  } catch (e) {
    if (e && e.code === "EADDRINUSE") throw fail(`port ${port} is already in use — pass a different --port`, 2);
    throw e;
  }
  console.log(`serving ${abs} at ${s.url} (Ctrl-C to stop)`);
  await new Promise(() => {});
}
