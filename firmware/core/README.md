# Transport Display on the CrowPanel

The 10.1-inch CrowPanel Advanced V1.2 with a revision 1.x ESP32-P4 uses one firmware for downloadable transport apps. The public directory offers a searchable list, package downloads and the current firmware image. The original Hemel page is also served on the Trains Panel Netlify site. [App directory](https://transport.pickering.org/apps/) · [Machine-readable manifest](https://transport.pickering.org/directory.json)

In **Settings → Apps**, **Installed** lists the apps on this tablet. **Directory** fetches the signed catalogue over Wi-Fi. Search by name, ID or description and use the page controls to browse longer lists. Each entry shows the download size and the flash allocation rounded to 4 KiB sectors. The header reports free and total app storage. **Download** installs the selected package. **Open** is available for installed apps offline. Updating the running app reboots into its new version. Downloading another app leaves the current display running.

**Delete** asks for confirmation and releases the app’s stored versions. Deleting the running app returns to the built-in launcher. Wi-Fi credentials, display settings and horn preferences are independent of the app files. **Settings → About** shows the running app’s data credits, the dedication and a scannable GitHub repository link.

## Publishing a release

The production Netlify site is `trains-panel` (site ID `c361ed45-7f40-4db4-be97-118f7594b033`). Its Git build runs `node build-preview.mjs` from `main`. Core v5 checks the custom HTTPS origin first and can also use the site's Netlify hostname. Both paths use public TLS certificate validation and verify the catalogue using the embedded release signing public key.

Use Node 22 or newer, the dependencies installed by `npm ci --prefix esp32`, Python with Pillow and `rsvg-convert`. Firmware requires ESP-IDF v5.5.3 with the ESP32-P4 toolchain. Signing takes place on the commissioning machine with the existing `.transport-private/signing.key`. Keep this key backed up privately. The firmware builder and Netlify site need only the public key. The examples show this release’s version numbers. Use a new version when changing the corresponding artifact.

```sh
node packages/compiler/app.mjs hemel .transport-private/hemel.tda
ART_PYTHON=python3 node packages/compiler/app.mjs lakes .transport-private/lakes.tda
tools/release/build-core.sh https://transport.pickering.org releases 5
node tools/release/publish.mjs .transport-private .transport-release \
    .transport-private/hemel.tda .transport-private/lakes.tda firmware/core/build/transport_display.bin 5
node tools/release/public.mjs .transport-release releases/signing.pem releases
node build-preview.mjs
```

The publisher reads IDs, adapters, names, descriptions and versions from the supplied packages. Include any number of package paths. An existing release directory retains omitted apps and firmware. On a fresh commissioning machine, supply every current package and firmware image when recreating the signing workspace. A new app ID can use an existing reader such as `hemel-corridor/1` or `lakes-map/1`. A new reader requires a firmware release. The tablet displays incompatible entries with their requirements.

Commit the exported `releases/` records and immutable images alongside the source change. The Netlify build verifies the signature and content hashes, generates the two scoped PWAs and builds the public directory. Older public artifact URLs remain available. The build has no access to the private signing key, USB backup or Wi-Fi settings.

The first transition from the LAN-only v4 firmware can use the original trusted HTTPS server to deliver v5. Once v5 starts, its directory and downloads come from the public site.

## Flash layout and recovery

| Region | Start | Capacity |
| --- | ---: | ---: |
| Existing NVS and PHY | 0x9000 and 0xF000 | 24 KiB and 4 KiB |
| Core slots | 0x10000 and 0x310000 | 3 MiB each |
| OTA metadata | 0x610000 | 8 KiB |
| App extents (original Hemel partitions) | 0x620000 and 0x890000 | 2,555,904 bytes each |
| App extents (original Lakes partitions) | 0xB00000 and 0xD70000 | 2,555,904 bytes each |

The four app partitions form a 9.75 MiB pool. Each package occupies a contiguous run of 4 KiB sectors in any one partition. Updates stage a separate extent, retaining the last confirmed copy until the new version boots successfully. The library and selected app are committed together in NVS. The first v5 boot imports the installed v4 packages in place.

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

For diagnostics, the USB console uses 115200 baud. `STATUS` reports the running slot, current app, versions, orientation, saved levels and refresh counter. `SHOT` captures the displayed framebuffer. `HOLD` copies the displayed frame to both buffers and prints their CRCs, then resumes after ten seconds or `RUN`. `APP check`, `APP install hemel`, `APP install lakes`, `APP install core` and `APP open lakes` and `APP delete hemel` invoke the same library actions as Settings.

## Commissioning results, 26 November 2026

The local panel loaded both apps over HTTPS and switched between them without USB flashing. Hemel received a live projection and Lakes received live vehicle observations. The v2-to-v3 core update was interrupted once during download and once after the new image began executing, before boot confirmation. The previous working core and Lakes came back both times. The next attempt installed v3. Core v4 then installed over Wi-Fi and booted the installed Hemel app.

Core v4 was 2,329,904 bytes. Hemel v2 was 42,497 bytes and took 490 ms to program after download. Lakes v2 was 1,067,817 bytes and took 6,579 ms to program. The panel gated the backlight for both writes and restored the current brightness on boot. With Lakes running, the static-frame check returned matching CRCs of `8c76979a` for the two display buffers.

In mobile-sized Chrome, Hemel updated from v1 to v2 with Lakes v1 still open. Both reopened offline. The final v2 packages also passed the Hemel 90-second booked-call check and the Lakes route 505 stop-board check offline. Physical Android and iOS installation remains unverified.

## Public directory rollout

Core v5 migrated the connected panel from v4 by OTA using its original local release server. The two installed v2 packages and the selected Lakes display survived migration. USB status reported 9,109,504 free bytes. Removing the inactive Hemel package increased free space by 45,056 bytes. Open was rejected until its public v3 download completed. Both v3 packages subsequently installed from the public site. The public manifest, firmware and package hashes were verified over HTTPS at both the custom domain and the Netlify hostname.
