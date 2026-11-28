# Testing Transport Display

From the repository root, install the JavaScript dependencies and run the tests on Node.js 22.4 or newer.

```sh
npm ci --prefix esp32
npm ci --prefix lakes
node --test
```

The suites cover the Hemel rail and live-feed reducers, Lakes timetable matching, bus headings and marker spacing across the recorded journeys, the bundled feed VM, package validation, release signing, numeric version ordering and repeatable browser offline builds. Release tests use temporary keys and outputs.

For the native tests and desktop renderer, install a C++17 compiler, CMake 3.24+, Ninja and SDL2 development files. The first configuration fetches LVGL 9.3.0.

```sh
cmake -S esp32 -B esp32/build -G Ninja
cmake --build esp32/build
ctest --test-dir esp32/build --output-on-failure
```

CTest exercises single-touch and pinch transitions, toolbar hit areas in both orientations, Settings tab order, Downloads updates that require a newer core, sunrise and sunset boundaries across UK clock changes, flash allocation and rollback, Lakes rail transitions, touch settings, horn PCM, recorded frames and live input in the Hemel simulator. [Simulator controls](../../esp32/README.md)

To check rail overlays in Chromium, serve the output of `node build-preview.mjs` and run `node tests/conformance/rail-overlay.cjs http://localhost:8000` with Playwright available to Node. Set `CHROME_BIN` to use a local Chrome installation. The check scrubs the Hemel recording and moves a train through each mapped regional berth while observing the infrastructure and camera.

For release acceptance, build the site, verify the public catalogue and hashes, open each scoped PWA online and reopen its recording offline. On a commissioned panel, record the running app, installed versions, free space and preferences. Install the core from Settings, update each app, open both and check their feeds and About versions. Restore the original app and compare preferences. [OTA commands and recovery](../../firmware/core/README.md)
