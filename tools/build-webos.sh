#!/bin/sh
# Builds the LG webOS package (.ipk) of this app.
#
#   tools/build-webos.sh [out-dir]
#
# Copies the app files (index.html, css, fonts, img, js including js/config.local.js) and
# webos/appinfo.json + its icons into <out-dir>/app (default: ../webos-build next to this
# app folder), then runs `ares-package` into <out-dir>. Left out: mock/, tools/, webos/
# sources, README.md, config.xml, icon.png (Samsung) and js/config.local.example.js.
#
# ares-package comes from the LG webOS CLI (npm package @webos-tools/cli). It is used from
# $ARES_DIR/node_modules/.bin when present (default ~/.webos-cli, see README.md), else
# from PATH. With NO_PACKAGE=1 only the folder is assembled.
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-"$HERE/../webos-build"}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
STAGE="$OUT/app"
ARES_DIR=${ARES_DIR:-"$HOME/.webos-cli"}

case "$STAGE" in "$HERE"|"$HERE"/*) echo "out-dir must be outside the app folder" >&2; exit 1;; esac

if [ ! -f "$HERE/js/config.local.js" ]; then
  echo "warning: js/config.local.js is missing: the package will have no suggestions and no weather" >&2
fi
for f in webos/appinfo.json webos/icon.png webos/largeIcon.png; do
  [ -f "$HERE/$f" ] || { echo "missing $f (icons: python3 tools/make_icon.py --webos)" >&2; exit 1; }
done

rm -rf "$STAGE"
mkdir -p "$STAGE/js"
cp "$HERE/index.html" "$STAGE/"
cp -R "$HERE/css" "$HERE/fonts" "$HERE/img" "$STAGE/"
for f in "$HERE"/js/*.js; do
  case "$(basename "$f")" in config.local.example.js) ;; *) cp "$f" "$STAGE/js/";; esac
done
[ -d "$HERE/js/vendor" ] && cp -R "$HERE/js/vendor" "$STAGE/js/"
cp "$HERE/webos/appinfo.json" "$HERE/webos/icon.png" "$HERE/webos/largeIcon.png" "$STAGE/"
find "$STAGE" -name '.*' -exec rm -rf {} + 2>/dev/null || true

if [ "${NO_PACKAGE:-}" = "1" ]; then echo "assembled $STAGE"; exit 0; fi

ARES_PACKAGE=ares-package
[ -x "$ARES_DIR/node_modules/.bin/ares-package" ] && ARES_PACKAGE="$ARES_DIR/node_modules/.bin/ares-package"
command -v "$ARES_PACKAGE" >/dev/null 2>&1 || { echo "ares-package not found: install the webOS CLI (README.md, LG TVs)" >&2; exit 1; }

"$ARES_PACKAGE" --no-minify -o "$OUT" "$STAGE"
ls -1 "$OUT"/*.ipk
