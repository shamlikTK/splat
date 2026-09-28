#!/usr/bin/env bash
# splat-site/scripts/chrome-software.sh — launch Chrome with software WebGL forced.
#
# Point a screenshot harness at this instead of at Chrome:
#   SCROLLCRAFT_CHROME=<skill>/scripts/chrome-software.sh node <scroll-craft>/scripts/shoot.mjs ...
#
# Why: a harness that launches Chrome with no GPU flags lets it try the real device first. On a
# host where the browser cannot open /dev/dri (the account is not in the video/render group, which
# is the normal case for a service user), WebGL falls back through an unstable path and the tab
# can close mid-walk — surfacing as "Target page, context or browser has been closed", which reads
# like a page fault and is not one. These are the same flags `splatsite check` uses, and it is
# stable on hosts where the bare launch is not.
#
# The real browser: $SPLATSITE_CHROME, else the newest Playwright Chromium, else a system install.
set -euo pipefail
REAL="${SPLATSITE_CHROME:-}"
if [ -z "$REAL" ]; then
  REAL=$(ls -d "$HOME"/.cache/ms-playwright/chromium*/chrome-linux/chrome 2>/dev/null | sort -V | tail -1 || true)
fi
if [ -z "$REAL" ]; then
  for c in /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    [ -x "$c" ] && REAL="$c" && break
  done
fi
if [ -z "$REAL" ]; then
  echo "chrome-software.sh: no Chrome found. Set SPLATSITE_CHROME to one." >&2
  exit 1
fi
exec "$REAL" --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist "$@"
