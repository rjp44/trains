#!/bin/sh
# Run in a shell with ESP-IDF v5.5.3 activated and the ESP32-P4 tools installed.
set -eu
base=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
url=${1:?Usage: build-core.sh HTTPS_ORIGIN PUBLIC_TRUST_DIRECTORY}
trust=$(CDPATH= cd -- "${2:?Missing trust directory}" && pwd)
case "$url" in https://*) ;; *) echo 'An HTTPS release origin is required' >&2; exit 2;; esac
if [ "$#" -gt 2 ]; then
    echo 'Set the release version in firmware/core/VERSION' >&2
    exit 2
fi
mkdir -p "$base/firmware/core/build"
feed="$base/firmware/core/build/board_feed_bundle.js"
node "$base/esp32/standalone/bundle.mjs" "$feed" --runtime-layout
idf.py -C "$base/firmware/core" -DRELEASE_TRUST="$trust" -DRELEASE_URL="${url%/}" -DFEED_PREPACKED="$feed" build
