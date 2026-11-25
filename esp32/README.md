# Hemel diagram on ESP32

The native renderer runs the 15-mile Hemel diagram, the Apsley–Berkhamsted close-up and the Watford Junction view. A laptop bridge supplies live trains, signal indications, Abbey station reports and Hemel cards. The three bundled recordings exercise the same display offline. The emulator boots into the 15-mile recording and switches to the bridge when it receives a valid snapshot.

## Run the laptop simulator

From the repository root, with Node.js 22.4+, CMake 3.24+, Ninja, a C++17 compiler and the SDL2 development package installed, run the following commands. On a Mac with the Xcode command-line tools, Homebrew provides `cmake`, `ninja` and `sdl2`. The first configure downloads the pinned LVGL 9.3.0 source.

```sh
cmake -S esp32 -B esp32/build -G Ninja
cmake --build esp32/build
ctest --test-dir esp32/build --output-on-failure
./esp32/build/hemel-sim --view sector --sample sector --at 5
```

Press **1**, **2** or **3** for the sector, Hemel or Watford view. **Tab** cycles through recordings independently of the view. **Space** pauses or restarts at the end, **←/→** seek ten seconds, **F** cycles 1×, 4× and 12×, **T** changes theme and **Esc** closes the window. Resizing the window scales the chosen pixel profile. To lay it out for another LCD, configure a separate build directory with `-DPANEL_WIDTH=800 -DPANEL_HEIGHT=480`.

Two frames are particularly useful when changing the renderer. The first shows 1A80 passing Hemel on the Up Fast and 2K65 calling on the Down Slow. The second shows the station-reported Abbey shuttle at Garston and a separate description at Watford platform 11. Add `--output frame.bmp` to save a frame without opening a window.

```sh
./esp32/build/hemel-sim --view hemel --sample hemel --at 90 --light
./esp32/build/hemel-sim --view watford --sample watford --at 110
```

## Live input and touch

From the repository root, install the bridge’s HTML parser once, then start the public feed and the simulator together. JavaScript, HTTPS, the public WebSocket and timetable lookups run on the laptop. The simulator and firmware consume the same byte stream. The bridge opens outbound connections and needs no subscription credentials.

```sh
npm ci --prefix esp32 --ignore-scripts
node esp32/bridge.mjs | ./esp32/build/hemel-sim --live
```

- Tap a **train badge** for its route, operator, booked times and reported delay when matched. The popout stays within the panel and follows the same identified service across berths. It shows **Last seen** when that service leaves the mapped area. Tap a **signal dot** for its name and current indication.
- Tap **×** or outside the popout to close it. The top-left view button cycles between the 15-mile sector, Hemel and Watford. Tapping the Hemel or Watford Junction station label jumps directly to its preset. The second button switches between light and dark. A mouse click exercises the same LVGL handler as a touch.
- The lower-left corner shows feed status and the latest TD observation in UTC. **Partial** means some signalling areas are still synchronising or stale. A stale area shows unknown signals and grey train badges. After 6.5 seconds without a valid bridge packet, **Link lost** appears and the Hemel cards clear. A fresh full snapshot restores the display.
- For a reproducible touch test, stream the recorded Hemel call through the live-input decoder. This command writes the light-theme 1A80 popout at the default 1024×600 resolution.

```sh
node esp32/bridge.mjs --recording hemel --at 90 --once | ./esp32/build/hemel-sim --live --view hemel --light --tap 567,266 --output /tmp/hemel-touch.bmp
```

## Run the firmware on a virtual ESP32-C3

Use the ESP-IDF v5.5.3 environment and keep Node on the host PATH for the asset build. Install Espressif’s RISC-V QEMU with `python "$IDF_PATH/tools/idf_tools.py" install qemu-riscv32`, then source `"$IDF_PATH/export.sh"` again. The IDF guide lists the host graphics libraries for each OS. [Espressif QEMU guide](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32c3/api-guides/tools/qemu.html)

```sh
cd esp32/qemu
idf.py set-target esp32c3
idf.py build
idf.py qemu --graphics monitor
```

The virtual LCD opens at 800×480 in the dark theme, five seconds into the sector recording. Look for 2N71 on the Down Fast and its card for the booked 23:41 Hemel call. The UART prints `Rendered sector replay +5s` after the first full frame. The firmware then advances the replay using the emulated device clock. For headless QEMU, use an SDL display backend with `SDL_VIDEODRIVER=dummy SDL_RENDER_DRIVER=software`; its refresh callback lets the virtual LCD finish drawing. [Virtual RGB panel driver](https://components.espressif.com/components/espressif/esp_lcd_qemu_rgb/versions/1.0.2/readme)

### Attach the live bridge to QEMU

With the ESP-IDF environment active and the firmware built, merge the bootloader, partitions and application into a virtual flash image. Run QEMU with a loopback UART socket. The 2 MB size below matches this project's QEMU configuration. Run these commands from the repository root in the first terminal.

```sh
cd esp32/qemu/build
esptool.py --chip esp32c3 merge_bin -o hemel-flash.bin --fill-flash-size 2MB @flash_args
qemu-system-riscv32 -machine esp32c3 -drive file=hemel-flash.bin,if=mtd,format=raw,snapshot=on -display sdl,gl=off -serial tcp:127.0.0.1:8176,server=on,wait=on -monitor none
```

In a second terminal at the repository root, run `node esp32/bridge.mjs --qemu 8176`. It connects the bridge to UART0, prints the firmware boot log and reconnects if QEMU restarts. The firmware prints `Bridge snapshot accepted` on switching from flash replay. Type `tap 40 17` in the bridge terminal to cycle views, or `tap 40 53` to change theme. For a repeatable train selection, start the bridge with `--recording hemel --at 90`, switch to the Hemel preset and tap near `443 213` on the 800×480 display. This serial tap drives the firmware’s LVGL pointer handler. A physical touchscreen will supply calibrated coordinates through the same interface.

## What transfers to a board

- **Geometry and timetable rules.** The build runs the existing corridor layout, station-name fitter, recording reducer and Hemel card selection in Node. It writes constant C++ tables for the selected resolution. Each recording contains timed marker changes and the eligible cards for each track pair. The firmware applies the changes as time advances and alternates opposing cards every five seconds. Native fonts and label borders differ from the browser. The source data and attribution travel with the repository. [Map sources and licence](../README.md#map-references-and-attribution)
- **Drawing.** `component/panel.cpp` accepts an LVGL display through `hemel::attach(display)`. The SDL and QEMU hosts supply the pixel flush callback, clock and a 24-row RGB565 drawing buffer. That buffer uses 49,152 bytes at 1024 pixels wide and 38,400 bytes at 800. LVGL also has a 96 KiB heap. The virtual display supplies its own framebuffer. A physical panel’s controller, bus and DMA requirements determine how much additional memory it needs.
- **Verification.** At 1024×600, all 293 visible marker centres in three sampled browser frames matched the generated positions to within half a pixel per axis. The 800×480 sector frame at +5 seconds matched between the SDL build and the emulated firmware at every RGB565 pixel. The default desktop CTest checks train and signal colours and locations, two vacated berths, both themes and the Abbey station report.

## Next milestones

1. **Standalone connectivity.** The bridge emits an atomic full snapshot on connection and every ten packets, with sequenced deltas or heartbeats in between at 1.5-second intervals. Each packet carries the protocol version, layout fingerprint, latest TD observation time and CRC32. The receiver rejects damaged batches or gaps and waits for the next full snapshot. Next, measure heap with Wi-Fi and TLS active on the chosen board and decide which upstream connections to move onto it.
2. **Touch navigation.** The current controls support train and signal inspection, themes and three fixed presets. Free drag, pinch zoom and physical touch calibration remain for the next iteration.
3. **Physical bring-up.** Identify the board revision, SoC, panel resolution, display controller and bus, touch controller, memory and vendor pin map. Replace the QEMU host with that board’s display and input drivers, set orientation and RGB byte order, and release each LVGL stripe when its transfer completes. Replay the same three frames on hardware, then measure refresh time, free heap with Wi-Fi active, and recovery after a disconnect. Optimize dirty-region redraws if the display bus needs it.

The 1024×600 desktop profile and the 800×480 virtual LCD are development targets. Selecting the physical board and its pin configuration can wait until its model is confirmed.
