# Transport Display on the CrowPanel

The production target is the Elecrow CrowPanel Advanced 10.1-inch, PCB V1.2, with a revision 1.x ESP32-P4, 16 MiB flash and 1024 × 600 display. One ESP-IDF application handles the launcher, hardware, Wi-Fi, OTA, and both native renderers. The first launch on an empty device opens Settings. [Public app directory](https://transport.pickering.org/apps/)

## Using the tablet

The gear at the top left opens Settings on the current app's tab. The sun or moon at the top right switches the app theme. Wi-Fi is the last tab.

- **Hemel** offers the 15-mile sector, Hemel Hempstead and Watford Junction views, live data and three recordings. Spread two fingers near Hemel or Watford in the sector diagram to open the nearer close-up. Pinch together to return to the sector.
- **Lakes** groups route filters, orientation, zoom, fit and live/replay controls on its tab. Pinch to zoom around the midpoint of your fingers and drag with one finger to pan. The app tabs also provide named views and zoom buttons for single-touch panels. Core 0.9.2 and Lakes 0.9.1 add route-aligned bus icons, roof views and spacing on busy roads. Core 0.9.3 and Lakes 0.9.2 add compact journey cards beside each vehicle. Tap a numbered chevron for intermediate stops or tap outside to dismiss. Upgrade the firmware first, then update Lakes in the app directory.

1. Open **Settings → Wi-Fi** and connect. Open **Apps → Directory** to retrieve the signed catalogue. Search names and descriptions or page through the results.
2. Each entry shows download size and on-device space. The header shows remaining capacity. **Download** and **Update** verify the package before writing it. Updating the running app restarts it. Updating another app leaves the current display running.
3. **Installed** lists the apps you can open offline. **Delete** asks for confirmation and frees the stored app. Deleting the running app restarts in the launcher. Wi-Fi credentials, brightness, horn and app-view preferences are stored separately.
4. **Update firmware** installs a newer core in the alternate boot slot. **About** shows the installed core and running app versions, the app’s data credits and the repository QR link.

## Publishing a release

Use Node.js 22.4+, Python 3 with Pillow, and `rsvg-convert` from librsvg. For firmware, activate ESP-IDF v5.5.3 with the ESP32-P4 toolchain. Run the following from the repository root. `releases/signing.pem` is the public key embedded in the production firmware. The existing private P-256 signing key belongs only on the commissioning machine.

Set the core release in `firmware/core/VERSION` and each app release in its own `apps/<id>/app.json`. Bump only components whose bytes change. The catalogue preserves components omitted from an incremental release. The packager and CMake convert versions to comparable OTA integers, so pre-0.9 tablets can install the release. [Version rules and package layout](../../packages/app-format/README.md)

```sh
npm ci --prefix esp32
mkdir -p .transport-private
node packages/compiler/app.mjs hemel .transport-private/hemel.tda
node packages/compiler/app.mjs lakes .transport-private/lakes.tda
tools/release/build-core.sh https://transport.pickering.org releases
node tools/release/publish.mjs .transport-private .transport-release \
  .transport-private/hemel.tda .transport-private/lakes.tda firmware/core/build/transport_display.bin
node tools/release/public.mjs .transport-release releases/signing.pem releases
node build-preview.mjs
```

Set `ART_PYTHON` if Pillow is installed in a virtual environment. The publisher checks that the core image targets this board, its project name is `transport_display`, and its ESP-IDF image version matches the release. It rejects a downgrade or changed bytes for an existing version. The exporter checks signatures, file sizes and hashes against the preceding public catalogue. A fresh signing workspace needs all current components. A fork commissioning its own tablets needs its own signing pair and its public key embedded at first flash.

Commit the source, signed records and content-addressed files in `releases/`. The `main` branch deploys to the existing trains-panel Netlify project. Its build command is `node build-preview.mjs` and its publish directory is `dist/`. Older public artifact URLs are retained for previously installed clients. After checking the public catalogue and an OTA installation, tag the release source. [Public manifest](https://transport.pickering.org/directory.json) · [Acceptance checks](../../tests/conformance/README.md)

## Commissioning and recovery

Identify the board, flash size, silicon revision and security state with esptool before the first USB flash. Back up and verify the original flash privately. For the supported 16 MiB unsecured board, set `PORT` to its programming port, run the following with esptool 5.x, and store the backup under a new name.

```sh
esptool --chip esp32p4 --port "$PORT" flash-id
esptool --chip esp32p4 --port "$PORT" get-security-info
esptool --chip esp32p4 --port "$PORT" read-flash 0 0x1000000 .transport-private/factory-backup.bin
esptool --chip esp32p4 --port "$PORT" verify-flash 0 .transport-private/factory-backup.bin
```

Build the core as above. Inspect the generated `firmware/core/build/flash_args` and its partition table. With the ESP-IDF environment active, flash this target once using the generated offsets.

```sh
cd firmware/core
idf.py -p "$PORT" flash
```

| Region | Offset | Capacity |
| --- | --- | --- |
| Settings (NVS), PHY | 0x9000, 0xF000 | 24 KiB, 4 KiB |
| Two OTA core slots | 0x10000, 0x310000 | 3 MiB each |
| OTA boot metadata | 0x610000 | 8 KiB |
| Four app extents | 0x620000, 0x890000, 0xB00000, 0xD70000 | 0x270000 bytes each |

The four extents provide 9.75 MiB of app storage. A download needs a contiguous run of 4 KiB sectors in one extent. An update stages the new copy alongside the confirmed one. The library and selected app are committed together in NVS. An interrupted download leaves the confirmed copy available. A failed first boot can roll an app or core back to its previous working version. Devices on the old LAN-only firmware need a one-time update from their previously trusted server or a commissioned USB flash to reach the public release channel.

## Diagnostics

The USB console runs at 115200 baud. Open it with DTR and RTS disabled to avoid resetting the panel. `STATUS` reports the slot, running app and versions, Wi-Fi, preferences and free app space. `APP check`, `APP install core`, `APP install hemel`, `APP open lakes` and `APP delete hemel` invoke the corresponding library actions. `SETTINGS` opens the touchscreen controls. For USB Wi-Fi provisioning, run `python3 firmware/core/provision.py "$PORT"` with pySerial installed.

For feed diagnosis, record the console while the tablet runs normally. Hemel logs relay connections, freshness changes and live train IDs. A `SHOT` framebuffer capture takes about 14 seconds over USB and can itself interrupt the feed. Lakes logs each HTTPS vehicle snapshot. [Hemel feed behaviour](../../apps/hemel/README.md#live-feed)
