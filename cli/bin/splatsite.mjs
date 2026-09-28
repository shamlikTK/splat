#!/usr/bin/env node
// splatsite/cli/bin/splatsite.mjs — command dispatch
const [cmd, ...rest] = process.argv.slice(2);
const usage = `splatsite <command>
  convert <video> [--quality fast|balanced|high] [--scale N] [--frames N] [--out ./scene] [--image TAG] [--cpu]   (default: fast)
  build <scene> --photos DIR [--out ./site]
  check <site-or-url> [--out shot.png]
  serve <site> [--port 4500]
  finish <scene>`;
const mods = { convert: "../lib/docker.mjs", build: "../lib/build.mjs", check: "../lib/check.mjs", serve: "../lib/serve.mjs", finish: "../lib/finish.mjs" };
if (!mods[cmd]) {
  // process.exitCode (not process.exit) so buffered stdout/stderr — e.g. this usage message,
  // or a piped `splatsite check ... | tee log` — is flushed before the process exits.
  console.error(usage);
  process.exitCode = cmd ? 2 : 0;
} else {
  const { main } = await import(new URL(mods[cmd], import.meta.url));
  try {
    process.exitCode = (await main(rest)) ?? 0;
  } catch (e) {
    console.error(`splatsite ${cmd}: ${e.message}`);
    process.exitCode = e.code === 2 ? 2 : 1;
  }
}
