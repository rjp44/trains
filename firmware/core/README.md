# Transport Display on the CrowPanel

The 10.1-inch CrowPanel Advanced V1.2 with a revision 1.x ESP32-P4 runs both Hemel and Lakes on the same firmware. Open **Settings → Apps → Check for updates** to see installed and available versions and download sizes. **Install Hemel** and **Install Lakes** download an app over Wi-Fi, check it, reboot and open it. **Open Hemel** and **Open Lakes** use their installed copies offline. **Update core** installs the newer firmware in the other boot slot.

The panel first draws a recorded frame, then connects to live transport feeds. Hemel provides the sector, Hemel and Watford views plus their recordings. Lakes includes the map, route filters, stop boards, timetable, rail and bus replay, portrait and landscape. The two apps save their display choices separately. Wi-Fi, brightness, volume and horn mode use the existing panel preferences.

## Local releases

Use Node 22 or newer, the dependencies installed by `npm ci --prefix esp32`, Python with Pillow, and `rsvg-convert`. The tablet build uses ESP-IDF v5.5.3 with its ESP32-P4 toolchain. Run these examples from the repository root. Choose a LAN address reachable **from the panel** and keep it stable for this core. On the commissioning Mac the working wired address is `192.168.178.62`.

```sh
tools/release/identity.sh 192.168.178.62 .transport-private
node packages/compiler/app.mjs hemel .transport-private/hemel.tda
ART_PYTHON=python3 node packages/compiler/app.mjs lakes .transport-private/lakes.tda
tools/release/build-core.sh https://192.168.178.62:8443 .transport-private 4
node tools/release/publish.mjs .transport-private .transport-release \
    .transport-private/hemel.tda .transport-private/lakes.tda firmware/core/build/transport_display.bin 4
node tools/release/serve.mjs .transport-private .transport-release 8443
```

Keep the private directory on the commissioning machine. The identity script reuses the release signing key and local CA and issues a server certificate for the given LAN IP. A builder needs only the public files `ca.pem` and `signing.pem`. The server serves the current edition and content-addressed artifacts. It reads the TLS key and certificate at startup. It picks up newly published editions without restarting.

Open `/apps/hemel/` or `/apps/lakes/` on the local HTTPS host. Each has its own manifest, start URL, icon and offline cache. Phones need to trust the commissioning CA to install a service worker. Transfer the public `ca.pem` directly from the commissioning machine and compare its SHA-256 fingerprint. The private CA key stays on that machine.

For an overlay update, change the app definition or source data, increment the version in its `apps/<id>/app.json`, and rebuild that package. Pass both package paths to `publish.mjs`. Omitting the core arguments retains the existing core release. An existing version cannot be reused for changed bytes. A core update uses a higher numeric version for both the IDF build and publication. Publish a compatible core first if an app requires a newer reader. Test the old app on the new core before updating its package.

## Flash layout and recovery

| Region | Start | Capacity |
| --- | ---: | ---: |
| Existing NVS and PHY | 0x9000 and 0xF000 | 24 KiB and 4 KiB |
| Core slots | 0x10000 and 0x310000 | 3 MiB each |
| OTA metadata | 0x610000 | 8 KiB |
| Hemel banks | 0x620000 and 0x890000 | 2,555,904 bytes each |
| Lakes banks | 0xB00000 and 0xD70000 | 2,555,904 bytes each |

For a panel with the original factory-only partition layout, make and verify a private USB backup first. The first 64 KiB contain boot metadata and the saved credentials. Compare the installed app with its known binary using `esptool verify-flash`, or read and verify the installed app if its contents are unknown. The commissioning backup includes `boot-table-settings.bin` at 0 and `lakes-app.bin` at 0x10000.

For the **one-time migration**, inspect the generated `firmware/core/build/flash_args`. The commissioning board uses DIO, 80 MHz, 16 MiB and the following segments. All update packages can subsequently be installed from Settings.

```sh
cd firmware/core/build
esptool --chip esp32p4 --port "$PORT" --baud 460800 write-flash \
    --flash-mode dio --flash-freq 80m --flash-size 16MB \
    0x2000 bootloader/bootloader.bin 0x8000 partition_table/partition-table.bin \
    0x10000 transport_display.bin 0x610000 ota_data_initial.bin
```

An interrupted download leaves the running core and active app banks intact. Core v4 downloads into bounded PSRAM, verifies the signed catalogue and the whole artifact, then turns the backlight off while programming the inactive slot. Brightness resumes at the selected level once the next boot draws its first frame. Each app bank must mount, pass its table and asset checks, and render locally before its pending selection becomes permanent. A reset during its first launch restores the previous selection. ESP-IDF guards the first core boot with its own rollback state. A failed new core can return to the earlier slot during startup. On an empty panel, the built-in recovery screen provides access to Wi-Fi and the app library.

To return this commissioned panel to the old Lakes firmware while keeping its **current** NVS, extract the bootloader and partition-table sections from its verified backup. These commands use the commissioning Mac’s relative backup paths from the repo root.

```sh
dd if=.transport-private/boot-table-settings.bin of=.transport-private/old-boot.bin bs=4096 skip=2 count=6
dd if=.transport-private/boot-table-settings.bin of=.transport-private/old-table.bin bs=4096 skip=8 count=1
esptool --chip esp32p4 --port "$PORT" write-flash \
    0x2000 .transport-private/old-boot.bin 0x8000 .transport-private/old-table.bin \
    0x10000 .transport-private/lakes-app.bin
esptool --chip esp32p4 --port "$PORT" verify-flash \
    0x2000 .transport-private/old-boot.bin 0x8000 .transport-private/old-table.bin \
    0x10000 .transport-private/lakes-app.bin
```

For diagnostics, the USB console uses 115200 baud. `STATUS` reports the running slot, current app, versions, orientation, saved levels and refresh counter. `SHOT` captures the displayed framebuffer. `HOLD` copies the displayed frame to both buffers and prints their CRCs, then resumes after ten seconds or `RUN`. `APP check`, `APP install hemel`, `APP install lakes`, `APP install core` and `APP open lakes` invoke the same library actions as Settings.

## Commissioning results, 26 November 2026

The local panel loaded both apps over HTTPS and switched between them without USB flashing. Hemel received a live projection and Lakes received live vehicle observations. The v2-to-v3 core update was interrupted once during download and once after the new image began executing, before boot confirmation. The previous working core and Lakes came back both times. The next attempt installed v3. Core v4 then installed over Wi-Fi and booted the installed Hemel app.

Core v4 was 2,329,904 bytes. Hemel v2 was 42,497 bytes and took 490 ms to program after download. Lakes v2 was 1,067,817 bytes and took 6,579 ms to program. The panel gated the backlight for both writes and restored the current brightness on boot. With Lakes running, the static-frame check returned matching CRCs of `8c76979a` for the two display buffers.

In mobile-sized Chrome, Hemel updated from v1 to v2 with Lakes v1 still open. Both reopened offline. The final v2 packages also passed the Hemel 90-second booked-call check and the Lakes route 505 stop-board check offline. Physical Android and iOS installation remains unverified.
