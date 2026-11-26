# Transport Display development preview

The first overlay follows 2K65 from the approach to Hemel Hempstead through its booked platform 3 stop and departure. It uses ten berths on the Down Slow and Up Slow tracks. The 36,124-byte package includes the map-data licence. The browser and CrowPanel load the same bytes.

## Preview and edit

Run from the repository root with Node 22.4 or later.

```sh
node web/player/preview.mjs
```

Open [the local preview](http://127.0.0.1:8187/). It starts paused at +90 s with the train at Hemel. Use the slider, **Next change** or **Play** to explore the recording. Edit `scene.station.x` in [overlay.json](../../apps/hemel/overlay.json) and press **Reload source**. The station band, its berths and the train move together. **Download package** saves the bytes served by the preview. **Open package** accepts a previously compiled file.

To reproduce the 72-pixel change while keeping the checked-in source intact, run the following commands. They create the two package files used by the hardware check.

```sh
node packages/compiler/build.mjs apps/hemel/overlay.json /tmp/hemel.tdp
node --input-type=module -e "import fs from 'node:fs'; const p = JSON.parse(fs.readFileSync('apps/hemel/overlay.json')); p.scene.station.x = 639; fs.writeFileSync('/tmp/hemel-edited.json', JSON.stringify(p));"
node packages/compiler/build.mjs /tmp/hemel-edited.json /tmp/hemel-edited.tdp
```

Open each file at +90 s. The badge centre moves from (567, 373) to (639, 373). The card still identifies service 722K65M724 and its booked 21:55 call. At +85.328 s both readers record one booked Down station entry. At +244.076 s the badge moves beyond the platform and the selected service leaves the card. On the physical panel, the RGB565 samples at (545, 361) and (617, 361) changed from `fe4c / 1144` to `1144 / fe4c`. Chrome showed the corresponding amber and background pixels exchange places. Both loads ran on the same development image, SHA-256 `d494b6c54ac95ba8c7de724e1f5b8a9db01ddbeec5419151fc93f0787ff495fd`. The [format reference](../../packages/app-format/README.md) describes the package fields and replay rules.

## Tablet development build

Use the ESP-IDF 5.5.3 environment for the **10.1-inch CrowPanel Advanced V1.2, ESP32-P4 revision 1.3**. The temporary build reuses the Lakes display driver, painter, recorded map and live HTTPS worker. Its UART accepts a package into PSRAM, validates and decodes it, and releases the staging buffer. Both the installed overlay and its replay cursor are volatile.

```sh
node lakes/esp32/pack.mjs
python3 lakes/esp32/pack-art.py
python3 lakes/esp32/terrain-tiles.py --output lakes/esp32/generated/terrain.tiles
idf.py -C lakes/esp32 -B "$PWD/lakes/esp32/build/transport-dev" -DTRANSPORT_DEV=ON build
```

Keep the current Lakes binary from `lakes/esp32/build/lakes_crowpanel_p4.bin`. On the tested factory layout, verify it against the device before the test. The commands below use esptool 5.x and pyserial in the active Python environment. Use the actual USB device in `PORT`. The normal Lakes project defaults to `TRANSPORT_DEV=OFF`.

```sh
PORT=/dev/cu.wchusbserial10
STOCK=lakes/esp32/build/lakes_crowpanel_p4.bin
DEV=lakes/esp32/build/transport-dev/lakes_crowpanel_p4.bin
python -m esptool --chip esp32p4 --port "$PORT" verify-flash 0x10000 "$STOCK" && \
  python -m esptool --chip esp32p4 --port "$PORT" --baud 460800 write-flash 0x10000 "$DEV"
python -m esptool --chip esp32p4 --port "$PORT" verify-flash 0x10000 "$DEV"
python firmware/player/usb_player.py "$PORT" /tmp/hemel.tdp --seek 90000
python firmware/player/usb_player.py "$PORT" /tmp/hemel-edited.tdp --seek 90000
python tests/conformance/panel.py "$PORT" /tmp/hemel.tdp /tmp/hemel-edited.tdp --bench
```

The two loads use the same native image. The check asserts seven clock positions, card identity, station-entry time and direction, plus RGB565 samples from the displayed framebuffer. The uploader also supports `--play`, `--pixel X Y`, and running the terrain test on its own with `--bench draw` or `--bench tls`.

Restore the original application after testing, including after a failed check. The app-only write starts at 0x10000. The stock NVS and PHY partitions are below that address.

```sh
python -m esptool --chip esp32p4 --port "$PORT" --baud 460800 write-flash 0x10000 "$STOCK"
python -m esptool --chip esp32p4 --port "$PORT" verify-flash 0x10000 "$STOCK"
python lakes/esp32/inspect.py "$PORT" --watch 40
```

Confirm `LAKES_STATUS wifi=1` and `live` after the first successful feed. The [factory recovery instructions](../../esp32/crowpanel-p4/README.md#identify-the-board-and-preserve-its-factory-image) cover the private full-flash backup and its restoration.

## Baseline and regression fixtures

The baseline is `a3958af` on `codex/panel-settings`. Both original firmware targets were built for the P4. Chrome ran the built Hemel site at +90 s and the built Lakes site with the 505 stop board using the checked-in recordings. The original apps retain their entry points.

| App or feature | Repeatable input and expected result |
| --- | --- |
| Hemel | Run `node server.mjs` for the [original dashboard](http://127.0.0.1:8174/?display=dashboard). Select Recorded replay → Hemel pilot. At +90 s the legacy app shows 1A80 passing and 2K65 calling. On the native 1024 × 600 Hemel view, (567, 266) selects 1A80 and (567, 137) selects the signal. [Reference frame](baseline/hemel-90s.png) |
| Overlay | [Clock and position fixtures](hemel.json) use `public/data/corridor.json` and `public/data/hemel-replay.json`. The test regenerates the legacy native geometry and compares the legacy reducer, card projection and station-arrival adapter with the captured outcomes. Only 2K65 is in this package. |
| Lakes | Run `node lakes/server.mjs` for the [original map](http://127.0.0.1:8186/). Frame 0 is 1795608354599 ms UTC. The Hayes Garden Centre board in Ambleside starts with 505 at 12:07 and 555 at 12:26 in opposing directions. Selecting 505 filters the departures. The existing timetable regression exercises both directions. [Deployed Lakes map](https://lakes-transit.netlify.app/) |
| Stock Lakes tablet | From live portrait mode, tap raw panel coordinates (19, 275) for Replay, (1000, 150) for route 505 and (601, 224) for Hayes Garden Centre. This produced `replay mask=1 zoom=2.796685 detail=Hayes Garden Centre`. The capture is rotated upright from the board's quarter-size diagnostic framebuffer. [Recorded stop board](baseline/lakes-505-hayes.png) |
| Shared Settings | `touchscreen_settings` drives the real LVGL controls in 1024 × 600 and 600 × 1024 against test Wi-Fi and preferences. It exercises hidden-network entry, keyboard symbols, Sound, all horn modes, volume, Display and brightness. On the restored portrait device, (19, 350) opens Settings from live mode. |

```sh
npm ci --prefix esp32 --ignore-scripts
node --test
node esp32/standalone/test.mjs
node build-preview.mjs
node lakes/build-pwa.mjs
cmake -S esp32 -B esp32/build/host -G Ninja
cmake --build esp32/build/host
ctest --test-dir esp32/build/host --output-on-failure
```

The conformance test compiles the tablet replay reader with a local C++17 compiler. It checks the web and native scene commands at the fixture times and rejects invalid checksums, offsets, capabilities and berth references. The existing five CTests cover the recorded panels, live-input touch, settings, rail report transitions and stereo PCM. For legacy firmware builds, see the [Hemel](../../esp32/crowpanel-p4/README.md) and [Lakes](../../lakes/esp32/README.md) build instructions.

| Factory-slot application | Bytes | SHA-256 of the baseline binary |
| --- | ---: | --- |
| Hemel | 2,308,048 | `cbb00db921b09419b64a215a60f8b5af5dc1b748d6817f8774940097e6960339` |
| Lakes | 5,923,696 | `4a380c15ada820e6a177fe741b6f0c7c9afabcc87a94f7546d69bc45486f51d7` |

The commissioning backup's SHA-256 was checked locally. The installed Lakes app matched the baseline binary before the test and again after restoration. The instrumented app was 6,022,496 bytes including both terrain representations. It is a benchmark image. Core slot sizing will use the extracted core.

### Original app timing and heap on the P4

Build either original IDF project in a separate build directory with `-DTRANSPORT_PROFILE=ON`. The normal app entry point then writes a `BASELINE` line after the first replay frame, the first live frame and roughly every ten seconds when another frame is drawn. Use the app-only backup and restore procedure above. Hemel measures from the LVGL render-start to render-ready event. Lakes measures from acquiring the back buffer through return from presentation.

| Original renderer | First sampled replay frame | Three sampled live frames | Internal heap high-water estimate | PSRAM heap high-water estimate |
| --- | ---: | --- | ---: | ---: |
| Hemel sector | 70.3 ms | 72.8, 61.7, 73.9 ms | 233,512 B | 5,612,120 B |
| Lakes portrait overview | 235.7 ms | 239.2, 227.2, 250.8 ms | 239,688 B | 2,527,268 B |

Both apps reached live data on the saved Wi-Fi connection. The last samples occurred at 35.4 s and 43.7 s on the respective app timers. Heap figures subtract ESP-IDF's minimum free size since boot from the total of the matching 8-bit memory regions. Region minima can occur at different times. These estimates include framebuffers, network allocations and other consumers of those heaps over the observed interval. [Original app samples and allocator counters](baseline/p4-apps.csv)

## Lakes terrain measurements

**Desktop storage.** Run `python3 lakes/esp32/terrain-tiles.py` after the existing art packer. This run regenerated the input with Pillow 13.0.0 and used zlib 1.2.12. The script reads the raster dimensions from `art.inc`, compresses each tile independently with zlib level 6, checks every decoded tile and optionally writes the exact indexed stream used on the P4. For the measured source, the terrain SHA-256 is `f1db89d8860b72d232d16420dcf2437dda92182876fba3edc84c2813b4a88509`.

| Raster | Raw indices | Streams | Index | Total | Largest decoded tile |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2302 × 1815, 270 tiles | 4,178,130 B | 516,591 B | 2,160 B | 518,751 B | 16,384 B |

**Physical P4, 26 November 2026.** The test draws the stock portrait replay at 2× zoom, first centred, then at five successive pans of eight map units. Each pose is drawn first from the stock flash bitmap and then from the independently compressed flash tiles using the P4 ROM inflater. The clock is fixed for each run. The tile path decodes each visible tile once per frame and retains no decoded tiles between frames. Both paths present through the stock DSI buffers. Complete framebuffer CRCs matched at every pose in both runs. [All 24 timings and checksums](baseline/p4-terrain.csv)

| Physical measurement | Stock raster | Tiled raster |
| --- | ---: | ---: |
| First centred frame, draw only, run 1 | 202.9 ms | 201.1 ms |
| Ten pan frames, median draw | 199.0 ms | 201.7 ms |
| Ten pan frames, median draw + presentation | 230.0 ms | 230.0 ms |
| Ten pan frames, full draw + presentation range | 229.8–424.3 ms | 229.8–265.8 ms |

The physical board read back all-train horns, volume 100% and brightness 100% on the final stock boot. Lakes resumed live Wi-Fi and its initial 3.375× zoom.

The board allocated 27,376 bytes of internal scratch for the tile path, including 16,384 bytes of pixels and 10,992 bytes of inflater state. It decoded 28 tiles for the centre view and 35 for each pan. The first frame starts with an empty software tile buffer. Hardware caches were left in their normal state. Presentation time includes the driver's two-refresh wait. These measurements cover a full map redraw and presentation after changing the centre. Physical touch sampling is outside the timer.

The Lakes worker was fetching over the saved Wi-Fi profile. Run 2 waited for an HTTPS request to begin before starting. The `tls` column marks a request in progress during any part of drawing or presentation, observed on 15 of the 24 frames. The development image reported minimum free heaps of 343,907 internal bytes and 31,045,988 PSRAM bytes by the end. These are allocator low-water marks since boot across both paths and network traffic. For the original-app measurements, enable the baseline profiling option described above.

The original live Lakes status at the start reported a 188 ms draw at 3.375× zoom. That uses a different map pose and clock from the controlled comparison. The measured tiles reduce terrain storage by 87.6% with a similar median frame time in this one portrait scenario. The full Lakes overlay, additional map poses and future core memory usage still determine the production codec and flash budget.
