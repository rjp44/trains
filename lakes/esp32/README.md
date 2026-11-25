# Lakes Transit on the CrowPanel

This application targets the Elecrow CrowPanel Advanced 10.1-inch V1.2, ESP32-P4 revision 1.x, 1024×600 with an ESP32-C6 Wi-Fi coprocessor. The default orientation is portrait, with the panel’s native right edge at the top. Tap **Turn** for landscape. The firmware reuses the Hemel project's EK79007 timing, GT911 wiring, ESP-Hosted SDIO configuration, SNTP and NVS provisioning from commit `cd06948`. On startup, GPIO41 resets the LCD controller. The map renderer fills the inactive RGB565 scanout buffer and waits for two refresh completions before reusing the previous buffer. Both buffers contain the first complete map before GPIO31 enables the backlight. [Elecrow V1.2 hardware drawing](https://github.com/Elecrow-RD/CrowPanel-Advanced-10.1inch-ESP32-P4-HMI-AI-Display-1024x600-IPS-Touch-Screen/tree/1408f16feabf76ae6172a0a8d59e014441cfa13b/Eagle_SCH%26PCB/1.2)

The panel opens with a labelled recorded map, then switches to live bus GPS and rail estimates from the deployed Lakes Transit HTTPS feed over its own Wi-Fi. The laptop preview can be stopped. A recent failed source is dimmed, and positions expire after ten minutes. **Replay** opens the saved frames, **Step** advances one and **Live** returns to the feed. Replay advances automatically every 15 seconds while no detail card is open.

Select route chips to combine lines. **All** restores the whole network. Tap **+** or **−** to zoom, swipe the map to pan and tap **Fit** to recenter the selection. Tap a vehicle for its timetable or rail reporting points. Tap a stop for the next three scheduled departures in each onward direction. **Prev** and **Next** page through the card. The winter timetable, terrain, ten routes, vehicle artwork and replay are embedded in flash.

## Build the application binary

Use ESP-IDF 5.5.3, Node.js 22+, Python 3 with Pillow 10.1+ and the `rsvg-convert` executable from librsvg. From the repository root:

```sh
node lakes/esp32/pack.mjs
python3 lakes/esp32/pack-art.py
idf.py -C lakes/esp32 build
```

The binary is `lakes/esp32/build/lakes_crowpanel_p4.bin`. Regenerate the two asset packs after updating the browser map or timetable. The terrain is indexed colour. Routes and schedules use compact tables, and the firmware reads the same JSON observation feed as the PWA. The C6 handles association and the P4 verifies the server certificate using ESP-IDF's certificate bundle.

With Docker, after generating the assets, the equivalent cross-build from the repository root is:

```sh
docker run --rm -v "$PWD/lakes/esp32:/project" -w /project espressif/idf:v5.5.3 idf.py build
```

## Load on the tested Hemel board

The tested panel uses a 15 MiB factory application partition starting at `0x10000`. An application-only write keeps its existing Wi-Fi credentials. With esptool 5.x and the board connected:

```sh
python -m esptool --chip esp32p4 --port /dev/cu.wchusbserial10 --baud 115200 write-flash 0x10000 lakes/esp32/build/lakes_crowpanel_p4.bin
python -m esptool --chip esp32p4 --port /dev/cu.wchusbserial10 verify-flash 0x10000 lakes/esp32/build/lakes_crowpanel_p4.bin
python lakes/esp32/inspect.py /dev/cu.wchusbserial10 --watch 40
```

The UART reports the Wi-Fi link, visible vehicle count, hardware refresh count, submitted frame count and live HTTPS snapshots. For a static display test, `--hold 5` pauses touch and map updates for five seconds, compares the two physical framebuffers, then resumes automatically. If the inspector loses its serial connection during the test, reconnect with `--run` to restore touch and live presentation. For a diagnostic image, run the inspector with `--capture panel.ppm`. The image uses the display's native landscape coordinates. To change networks, run `python lakes/esp32/provision.py /dev/cu.wchusbserial10` and restart the board. The Hemel and Lakes binaries use the same NVS key. To return to Hemel, use its matching P4 application binary at the same address.

During the hardware test, the previous Hemel image disappeared after the new LCD initialization. A faint flicker on solid colours remained through a USB reset. Disconnecting all panel power for 30 seconds and reconnecting cleared it in dark mode. Wi-Fi and the live feed resumed on startup. If the same symptom returns after flashing, repeat the full power cycle.

Geographic, timetable, rail and terrain sources are credited in the [Lakes map documentation](../README.md). The UI font atlas uses Pillow’s bundled [Aileron Regular](https://dotcolon.net/fonts/aileron/).
