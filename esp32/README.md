# Hemel renderer and simulator

The desktop simulator uses SDL2 and the same LVGL schematic and packet decoder as the CrowPanel. The production core also uses the feed client under `crowpanel-p4/main/` and the common Wi-Fi, display and sound settings under `panel_settings/`. [CrowPanel firmware](../firmware/core/README.md)

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
