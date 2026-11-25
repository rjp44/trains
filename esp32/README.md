# Hemel diagram on ESP32

The native renderer runs the 15-mile Hemel diagram, the Apsley–Berkhamsted close-up and the Watford Junction view. The three bundled recordings supply the trains, signal indications, Abbey station reports and automatic Hemel cards. Use the laptop simulator to explore them. The ESP-IDF firmware runs the same renderer on an emulated ESP32-C3 and loops the 15-mile recording.

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

## Run the firmware on a virtual ESP32-C3

Use the ESP-IDF v5.5.3 environment and keep Node on the host PATH for the asset build. Install Espressif’s RISC-V QEMU with `python "$IDF_PATH/tools/idf_tools.py" install qemu-riscv32`, then source `"$IDF_PATH/export.sh"` again. The IDF guide lists the host graphics libraries for each OS. [Espressif QEMU guide](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32c3/api-guides/tools/qemu.html)

```sh
cd esp32/qemu
idf.py set-target esp32c3
idf.py build
idf.py qemu --graphics monitor
```

The virtual LCD opens at 800×480 in the dark theme, five seconds into the sector recording. Look for 2N71 on the Down Fast and its card for the booked 23:41 Hemel call. The UART prints `Rendered sector replay +5s` after the first full frame. The firmware then advances the replay using the emulated device clock. For headless QEMU, use an SDL display backend with `SDL_VIDEODRIVER=dummy SDL_RENDER_DRIVER=software`; its refresh callback lets the virtual LCD finish drawing. [Virtual RGB panel driver](https://components.espressif.com/components/espressif/esp_lcd_qemu_rgb/versions/1.0.2/readme)

## What transfers to a board

- **Geometry and timetable rules.** The build runs the existing corridor layout, station-name fitter, recording reducer and Hemel card selection in Node. It writes constant C++ tables for the selected resolution. Each recording contains timed marker changes and the eligible cards for each track pair. The firmware applies the changes as time advances and alternates opposing cards every five seconds. Native fonts and label borders differ from the browser. The source data and attribution travel with the repository. [Map sources and licence](../README.md#map-references-and-attribution)
- **Drawing.** `component/panel.cpp` accepts an LVGL display through `hemel::attach(display)`. The SDL and QEMU hosts supply the pixel flush callback, clock and a 24-row RGB565 drawing buffer. That buffer uses 49,152 bytes at 1024 pixels wide and 38,400 bytes at 800. LVGL also has a 96 KiB heap. The virtual display supplies its own framebuffer. A physical panel’s controller, bus and DMA requirements determine how much additional memory it needs.
- **Verification.** At 1024×600, all 293 visible marker centres in three sampled browser frames matched the generated positions to within half a pixel per axis. The 800×480 sector frame at +5 seconds matched between the SDL build and the emulated firmware at every RGB565 pixel. The default desktop CTest checks train and signal colours and locations, two vacated berths, both themes and the Abbey station report.

## Next milestones

1. **Live data while the board is in transit.** Add a live input beside replay. Start with a laptop bridge using the existing public feed client, Abbey reports and Hemel timetable matcher. Stream a versioned initial snapshot and bounded deltas with sequence numbers and timestamps. The device must expire a stale area, clear ineligible cards, and request a new snapshot after a gap or reconnect. Feed a recording through the bridge and compare with local replay, then compare a live session side by side with the browser. Measure TLS memory before deciding whether to move individual connections onto the board.
2. **Touch and view controls.** Add hit testing for trains, signals and stations, the light/dark switch and train popouts constrained to the panel. Use SDL pointer events first, then bind the same actions to the touchscreen. Extend the three fixed presets to free pan and zoom, keeping station columns and train centres aligned at each scale.
3. **Physical bring-up.** Identify the board revision, SoC, panel resolution, display controller and bus, touch controller, memory and vendor pin map. Replace the QEMU host with that board’s display and input drivers, set orientation and RGB byte order, and release each LVGL stripe when its transfer completes. Replay the same three frames on hardware, then measure refresh time, free heap with Wi-Fi active, and recovery after a disconnect. Optimize dirty-region redraws if the display bus needs it.

The 1024×600 desktop profile and the 800×480 virtual LCD are development targets. Selecting the physical board and its pin configuration can wait until its model is confirmed.
