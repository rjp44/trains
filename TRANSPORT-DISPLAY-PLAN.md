# Transport Display migration plan

Evolve `rjp44/trains` into one repository that produces a tablet firmware, independently downloadable transport apps and an installable web player. A user should be able to pick **Hemel** or **Lakes** in **Settings → Apps**, download it over Wi-Fi, and open it again after a power cut. An author should be able to change a station, route, card layout or timetable, preview the change in a browser and publish it without rebuilding the firmware.

## Starting point

Use `codex/panel-settings` at `a3958af` as the integration baseline. This checkout already contains both apps and their history. The hardware tested in this repo is the Elecrow **10.1-inch** CrowPanel Advanced V1.2, ESP32-P4 revision 1.3, 1024 × 600, with 16 MiB flash, 32 MiB PSRAM and an ESP32-C6 Wi-Fi coprocessor. Use the board model and revision as its identifier. Confirm the label before treating a 10.6-inch panel as the same target. [Board commissioning record](esp32/crowpanel-p4/README.md)

| Area | What we can carry forward | What needs to change |
| --- | --- | --- |
| Tablet | Both apps already share Wi-Fi provisioning, saved preferences, the settings UI and the stereo horn in `esp32/panel_settings/`. | Each builds its own firmware, initialises its own display and handles touch differently. One board driver must own panel reset, frame presentation, backlight and touch rotation. |
| Hemel | Corridor geometry, recordings, berth relationships, the JavaScript feed reducer and the QuickJS port already exist. The native and browser versions have geometry comparison tests. | The packer emits C++ tables and the feed bundle embeds corridor data. Pass package data into the reducer and renderer at runtime. [Hemel packer](esp32/pack.mjs) · [On-device feed](esp32/standalone/board.mjs) |
| Lakes | The PWA and firmware already draw from the same map, timetable and replay source data. The deployed aggregation function provides bus and rail snapshots to both. | The device packer emits C++ tables and a linked terrain bitmap. The browser and device each implement the map, filters and detail cards. [Lakes packer](lakes/esp32/pack.mjs) · [Live feed](lakes/feeds.mjs) |
| Web | Both apps have manifests. Lakes also builds a versioned offline service worker. | The manifests both use `/` as their identity and scope on their respective sites. Give apps distinct identities on a shared host and generalise the Lakes worker for both. [Hemel manifest](public/manifest.webmanifest) · [Lakes worker builder](lakes/pwa-worker.mjs) |

## Repository and ownership

```text
firmware/
  boards/crowpanel-p4-v1_2/    ESP-IDF board support, pinout and display timing
  core/                       Boot, setup, app library, preferences, storage and updates
  player/                     Native scene rendering, input actions and feed adapters
apps/
  hemel/                      Manifest, views, bindings, corridor, recordings and credits
  lakes/                      Manifest, views, bindings, map, timetable, recordings and credits
packages/
  app-format/                 Versioned schemas, field types, units and compatibility rules
  compiler/                   Validation and deterministic package and catalogue builds
  transport-model/            Reusable feed logic, event definitions and replay fixtures
web/player/                   JavaScript renderer, preview controls and PWA shell
services/                     Lakes aggregation and Hemel lookup proxies
tests/conformance/            Identical package, clock, input and expected results for both players
```

Create these directories as their contents move. Keep the existing build commands and deployment entry points working through the transition. The board interface should expose frame presentation, orientation-aware pointer input, backlight level and stereo audio. The core owns Wi-Fi, certificate and clock setup, persistent settings, app selection and a small built-in recovery screen. Global brightness, volume, horn mode and the existing Wi-Fi profile retain their on-device keys. Persist app-specific choices such as selected routes under the app ID.

## What an overlay contains

Author each overlay as readable, schema-validated JSON plus assets. Compile it into an immutable, versioned package with a manifest, typed tables, a scene description, replay fixtures and credits. Give each package section an offset, length and digest so the P4 can read indexed tables or decode a visible tile within a bounded amount of RAM. Use stable IDs to join records across sections. Carry source attribution and applicable licence files into both the download and the PWA.

| Author declares | Hemel example | Lakes example |
| --- | --- | --- |
| Sources and keys | Signal Maps subscription areas R1, WJ and WS. A berth is keyed by area and address. | The vehicles endpoint, route IDs and timetable edition. A vehicle joins its route by ID. |
| Relationships | A berth belongs to a track and station. A matched service on its operating date supplies the booked call for a card. | Trips reference service calendars and ordered stop patterns. Each boarding point references the stop group displayed on the map. |
| Layout and interaction | A schematic layer draws track paths, signals and berth labels. A card region binds to the eligible services for its track pair. Tapping a signal opens its details. | A map orders terrain, routes, stops and vehicles. Tapping a route filters layers and departures. Selecting a stop opens its board. |
| Events and policies | A fresh station entry carries direction and booked-stop status to the horn policy. | A fresh change of rail reporting point carries direction and passenger-stop status. Bus updates and interpolated motion produce no horn event. |

For example, this proposed fragment expresses the Lakes stop board. The map's tap action sets the selected stop group. Either player can resolve the binding against the same clock, tables and route selection.

```json
{
  "id": "stop-board",
  "view": "departure-list",
  "source": "scheduled-departures",
  "bind": {
    "stopGroup": "selection.stopGroupId",
    "routes": "filters.routeIds",
    "at": "clock.displayTime"
  },
  "groupBy": "onwardDirection",
  "limitPerGroup": 3
}
```

Ship a small vocabulary of layers, labels, lists, cards, selection, filtering and named transport operations. Put the vocabulary and its semantics under version control. Keep TD sequencing and resynchronisation, schedule identity matching, timetable service-day arithmetic and geographic projection in tested adapters. Overlays select adapters by ID and supply validated parameters. The initial format is data-only. Adding an unsupported operation means releasing a new player capability, then publishing a package that declares it. This gives a third corridor using existing capabilities a data-only authoring path.

Keep the known feed topology. Hemel can continue using its direct WebSocket and the existing bounded QuickJS reducer on the P4. The web player can import the same reducer as a JS module. Lakes continues to aggregate the national bus archive on the server. Adapters expose typed observations with source time, identity, freshness and explicit unknown values. Each player applies the same replay clock and rules for stale data, reconnect baselines, stop eligibility and direction. A package selects registered sources. Credentials and device access stay in their owning service or platform.

## One app definition on the tablet and web

Build a JavaScript player that reads the same scene, bindings, IDs and test recordings as the native player. Declare layer order, anchors, sizing constraints and portrait or landscape overrides in the app. A release may contain indexed images with RGB565 palettes for the tablet and WebP or vector assets for a browser. Both representations carry the same app version and refer to the same geometry. Start with the existing Hemel schematic renderer and Lakes map renderer behind the native player interface. Share view definitions and input actions before replacing their drawing code.

Offer two web views from that player. **Tablet preview** uses the device viewport, portrait or landscape, with a controllable replay clock. **Installed app** fits the phone or tablet, with touch controls and accessible HTML for cards and settings. Enable browser sound after a user gesture. Hardware controls such as Wi-Fi provisioning and physical backlight belong to the tablet, with simulated controls available in preview. [Browser audio activation](https://developer.chrome.com/blog/autoplay/)

On the shared HTTPS host, publish `/apps/hemel/` and `/apps/lakes/` with distinct manifest IDs, start URLs, scopes, icons and per-app offline caches. Cache the shell, the last complete compatible package and its replay. Keep live responses timestamped and mark stale data explicitly when offline. Retain the current site origins and lookup URLs during migration so installed copies and deployed firmware continue to work. Test installation, offline relaunch and upgrading one app while the other stays open on Android Chrome and iOS Safari. [Web App Manifest](https://www.w3.org/TR/appmanifest/) · [PWA installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

## Storage and updates

The current Hemel image is **2,308,048 bytes** and Lakes is **5,923,696 bytes**. These are whole application images with embedded assets. The shipped partition table has one 15 MiB factory slot and no OTA slots. Plan a **one-time USB migration** to install an OTA-capable bootloader, partition table and initial core while preserving the current NVS offsets and contents. Retain a verified USB recovery image. Subsequent normal core and overlay releases can travel over Wi-Fi. [Current partition table](esp32/crowpanel-p4/partitions.csv) · [Espressif OTA for the P4](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32p4/api-reference/system/ota.html)

**Size the storage before choosing partition offsets.** The Lakes indexed terrain currently occupies 4,178,130 bytes. In a desktop sizing test, splitting the existing 2302 × 1815 raster into 270 tiles of up to 128 × 128 pixels and compressing each independently with zlib level 6 produced 516,591 bytes. With an illustrative eight-byte index entry per tile, that is **518,751 bytes**. Each tile round-tripped exactly and needs at most 16 KiB of decoded pixels. The figure covers the terrain only. Measure tile-cache memory, pan latency, cold drawing and simultaneous TLS traffic on the P4 before selecting the codec. [Terrain packer](lakes/esp32/pack-art.py)

Budget for **two aligned core slots**, OTA metadata, the existing NVS and PHY data, and an asset store that holds both installed apps plus the largest pending update and rollback data. Measure the combined core and actual installed package sizes, including indexes, signatures, allocation overhead and growth allowance. A first estimate can try two 3 MiB core slots, leaving under 10 MiB for everything else. If the measured budget fails, reduce or deduplicate large assets first. A removable asset store is a fallback to qualify on hardware. Keep setup, recovery and the active firmware in internal flash.

| Release | Installation and recovery |
| --- | --- |
| **App overlay** | Settings lists available and installed apps, versions and download sizes. Stream a package into staging over HTTPS. Verify its signature against a trusted release key, then check hashes, lengths, references, decoded-size limits, storage and required capabilities. Mount it and render a recorded frame before atomically switching the active-version record. If the new package repeatedly fails to start, open the previous version or built-in recovery screen. Switching apps stops old subscriptions and audio, clears transient events and starts the new app from its own baseline. |
| **Tablet core** | Publish a signed image per board/revision with a distinct core version. Write it to the inactive ESP-IDF OTA slot, verify and reboot with rollback enabled. Confirm it only after local checks can initialise the display, open Settings, read preferences and load a compatible installed app or recovery view. An upstream outage must still permit a healthy offline boot. [ESP-IDF OTA validation and rollback](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32p4/api-reference/system/ota.html) |
| **Core and app together** | The signed catalogue declares package schema, required capabilities, supported board targets, sizes and immutable artifact hashes. Publish artifacts before the catalogue. Stage both releases and retain a compatible old core/package pair until the new pair passes. Exercise rollback with an older reader and use backward-readable settings during the rollback window. |

## Delivery sequence

| Milestone | Work | Exit check |
| --- | --- | --- |
| **1. Capture the working baseline** | Bring the integrated branch into the intended development line. Record existing build commands and site URLs, representative replay frames, touch targets, package inputs, firmware sizes, peak RAM and frame times. Save the factory recovery procedure. | Both existing apps build and run. A repeatable replay exercises Hemel cards and station entries, Lakes filters and departures, and the shared settings. |
| **2. Prove one overlay end to end** | Write the first schema and compiler. Convert one Hemel station, track pair, card and replay into a package. Load the identical package in a JS preview and into PSRAM over USB on a development build. Change the layout and reload it. Benchmark the Lakes terrain tiles alongside this work. | The same timed input produces the same positions, selected card and horn event in both players. Changing the overlay changes the tablet view without recompiling native code. Measure flash, peak RAM and pan latency against today's renderer before committing to a codec. |
| **3. Extract the core and port both complete apps** | Consolidate the two display paths behind one owner. Port the Hemel views and Lakes layers, filters, stop boards, art and timetables. Move the remaining app-specific constants out of the runtime. Add the local app library and offline startup. | One firmware hash runs either complete overlay. Switch between them repeatedly in both orientations where supported. Check touch accuracy, backlight stability, reconnects, unknown signal state, booked versus passing trains and stereo direction. |
| **4. Deliver the web player and installable apps** | Build the shared web shell, separate manifests, scoped caches and the existing feed routes. Compare browser and tablet output at the same replay instants and after the same taps. This can start as soon as milestone 2 defines the contract. | Install both apps on one phone. Each opens its own selected app offline, replays the correct dataset, resumes live data when online and updates independently. Geometry, IDs and event outcomes match the tablet fixtures. |
| **5. Deliver downloads and core OTA** | Finalise the flash map from measured artifacts. Rehearse USB migration and recovery, publish a test catalogue, then exercise package and firmware updates separately and together. | Interrupt staging, activation and first boot. Try a full store, damaged package, wrong board image and unsupported schema. Recover the previous working pair and saved Wi-Fi. Then update Hemel alone with Lakes installed, update the core, and cold-boot each app. |
| **6. Cut over and rename** | Publish the new builds alongside the known-good sites. Promote after the device and phone checks pass. Rename the existing GitHub repo to **transport-display**, update remotes, CI, Netlify settings and docs, and verify existing app and feed URLs. Keep the release catalogue on a stable URL independent of the repository name. | A clean checkout can build the firmware, preview either app and publish a versioned overlay. Existing devices and bookmarks reach their feeds. [GitHub repository renaming](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository) |

**The first implementation PR should deliver the baseline fixtures, the minimal Hemel package, both replay readers and the Lakes storage benchmark.** Use it to demonstrate that one layout change appears in both players and to measure how smoothly the largest asset draws on the tablet. Finalise partition sizes once the complete apps and combined core have been measured.
