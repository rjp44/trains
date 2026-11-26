#!/bin/sh
# Run in a shell with ESP-IDF v5.5.3 activated and the ESP32-P4 tools installed.
set -eu
base=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
url=${1:?Usage: build-core.sh HTTPS_ORIGIN PUBLIC_TRUST_DIRECTORY CORE_VERSION}
trust=$(CDPATH= cd -- "${2:?Missing trust directory}" && pwd)
version=${3:?Missing numeric core version}
case "$url" in https://*) ;; *) echo 'A local HTTPS origin is required' >&2; exit 2;; esac
case "$version" in ''|0|0*|*[!0-9]*) echo 'Expected a positive integer core version' >&2; exit 2;; esac
mkdir -p "$base/firmware/core/build"
feed="$base/firmware/core/build/board_feed_bundle.js"
node "$base/esp32/standalone/bundle.mjs" "$feed" --runtime-layout
idf.py -C "$base/firmware/core" -DRELEASE_TRUST="$trust" -DRELEASE_URL="${url%/}" -DFEED_PREPACKED="$feed" -DPROJECT_VER="$version" build
