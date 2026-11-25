# Physical Hemel panel

This build targets the **Elecrow CrowPanel Advanced 10.1-inch ESP32-P4, PCB V1.2, 1024×600**. The image has been cross-compiled with ESP-IDF 5.5.3 for P4 silicon revisions 1.0–1.99. Match the PCB marking, chip revision and panel before programming. The vendor's V1.2 display example supplies the LCD porch and sync timings, EK79007 initialization, backlight on GPIO31 and GT911 touch wiring. The shared Hemel component supplies the diagram, touch actions, replay and stream decoder. [Elecrow V1.2 display example](https://github.com/Elecrow-RD/CrowPanel-Advanced-10.1inch-ESP32-P4-HMI-AI-Display-1024x600-IPS-Touch-Screen/tree/1408f16feabf76ae6172a0a8d59e014441cfa13b/example/V1.2/idf-code/Lesson09-LVGL_Lighting_Control)

## Identify the board and preserve its factory image

On the Mac, install the host tools in the worktree from the repository root. The USB bridge uses pySerial, which esptool installs. Use a USB data cable and the board's programming connector.

```sh
python3.12 -m venv esp32/build/board-tools
PY=esp32/build/board-tools/bin/python
"$PY" -m pip install esptool==5.7.0
"$PY" -m serial.tools.list_ports -v
```

Set `PORT` to the board's callout device from that listing. On this Mac the USB adapter enumerated as WCH `1A86:7522`. If `systemextensionsctl list` shows `cn.wch.CH34xVCPDriver` as `activated waiting for user`, enable it under **System Settings → General → Login Items & Extensions → Driver Extensions** and list the ports again. The adapter identifier alone cannot establish the chip or PCB revision.

To capture factory startup messages, run the serial monitor below and press the board's reset button. Close the monitor before opening the port with esptool. Record the detected chip revision, flash capacity and security state alongside the board's printed model and revision.

```sh
"$PY" -m serial.tools.miniterm --raw --rts 0 --dtr 0 "$PORT" 115200
"$PY" -m esptool --port "$PORT" flash-id
"$PY" -m esptool --port "$PORT" get-security-info
```

For an unencrypted board with unrestricted download access, save the whole detected flash to a new private directory, verify it against the device and keep the checksum with the image. If security restrictions prevent a verified backup, establish the manufacturer's recovery procedure before replacing the factory application. Elecrow publishes separate factory images by hardware revision. [Vendor factory firmware](https://github.com/Elecrow-RD/CrowPanel-Advanced-10.1inch-ESP32-P4-HMI-AI-Display-1024x600-IPS-Touch-Screen/tree/1408f16feabf76ae6172a0a8d59e014441cfa13b/factory_firmware)

```sh
backup=$(mktemp -d "$HOME/Documents/hemel-factory.XXXXXX")
"$PY" -m esptool --port "$PORT" read-flash 0 all "$backup/factory.bin"
"$PY" -m esptool --port "$PORT" verify-flash 0 "$backup/factory.bin"
(cd "$backup" && shasum -a 256 factory.bin > factory.bin.sha256)
```

If you later need to restore this same unencrypted board, check the saved image with `(cd "$backup" && shasum -a 256 -c factory.bin.sha256)`. An intentional full restore uses `"$PY" -m esptool --port "$PORT" write-flash 0 "$backup/factory.bin"`, followed by the same `verify-flash` command above.

## Build and check the first boot

With the matching ESP-IDF 5.5.3 environment and Node.js 22.4+ on PATH, run `npm ci --prefix esp32` and then `idf.py -C esp32/crowpanel-p4 build` from the repository root. The component manager resolves the locked LCD, touch and LVGL versions. The standalone build instructions below include both host-generated assets for Docker. The C3 emulator uses its own bootloader and display driver.

Once the board identity, recovery image and first write are confirmed, flash the board-specific build using `idf.py -C esp32/crowpanel-p4 -p "$PORT" flash monitor` on a host with serial access. A native esptool can also use the board build's `flash_args` file from its build directory. The UART should print `Sector +5s drawn at 1024x600`. Verify that the LCD shows the four WCML lines, the DC and Abbey branches, and the 2N71 Hemel card. Tap a station label, a train badge, a signal and the theme button to check touch orientation across the panel.

### App-only update on the tested V1.2 board

The tested board reported ESP32-P4 revision 1.3, 16 MB of flash, 32 MB of PSRAM, an EK79007 LCD and GT911 touch. Its factory partition table placed a 15 MiB application at `0x10000`. After verifying the factory backup and that layout, use the following command from the repository root to update just the application. The USB link on the test Mac was most reliable at 115200 baud.

```sh
APP=esp32/crowpanel-p4/build/hemel_crowpanel_p4.bin
"$PY" -m esptool --chip esp32p4 --port "$PORT" --baud 115200 write-flash 0x10000 "$APP"
"$PY" -m esptool --chip esp32p4 --port "$PORT" --baud 115200 verify-flash 0x10000 "$APP"
```

The factory firmware uses two 1 Gbit/s DSI lanes and a 51 MHz pixel clock. GPIO31 holds the backlight enabled while the diagram is visible. The display uses native RGB565 and two full-screen DSI buffers in 200 MHz PSRAM. LVGL draws into the inactive buffer and presents it at the refresh boundary. In the default theme, the background is dark teal and train badges are amber. In the light theme, the background is off-white.

## Feed the panel over USB

Close the serial monitor and install the Node dependencies with `npm ci --prefix esp32 --ignore-scripts`. These commands start the bridge separately, first with a recording and then with the public live feed. Stop each session with Ctrl+C.

```sh
"$PY" esp32/usb_bridge.py "$PORT" --recording hemel --at 90
"$PY" esp32/usb_bridge.py "$PORT" --recording watford --at 110
"$PY" esp32/usb_bridge.py "$PORT"
```

The bridge forwards unchanged protocol bytes at 115200 baud, displays board diagnostics, and starts a new full snapshot when the same device path reconnects. Select the **Hemel** view for 1A80 and 2K65, then **Watford** for the Abbey shuttle at Garston. To check loss and recovery without cutting board power, stop the bridge for seven seconds, look for **Link lost**, and restart it. A physical cable removal can also power-cycle a USB-powered panel.

## Standalone Wi-Fi and stereo arrivals

The P4 opens a certificate-verified WebSocket to Signal Maps for R1, WJ and WS. It reads dated running schedules from Open Rail and Abbey calling points from Railinfo over HTTPS. The firmware runs the same relay reducer, service matching, card selection and projection as the USB bridge in a bounded QuickJS runtime in PSRAM. The network needs DHCP, DNS, internet access and a working time source for SNTP. A full USB snapshot takes control while the bridge is connected. After 6.5 seconds of UART silence, a full Wi-Fi frame can take over. A board without saved network settings boots into the bundled replay and accepts USB as before.

From the repository root, run `npm ci --prefix esp32` before `idf.py -C esp32/crowpanel-p4 build`. For a Docker toolchain without Node, pre-generate **both** flash assets on the host and pass their container paths to IDF.

```sh
mkdir -p esp32/build
node esp32/pack.mjs 1024 600 esp32/build/p4_assets.h
node esp32/standalone/bundle.mjs esp32/build/board_feed.js
# With the checkout mounted at /work in the IDF container:
idf.py -C /work/esp32/crowpanel-p4 -DPANEL_PREPACKED=/work/esp32/build/p4_assets.h \
  -DFEED_PREPACKED=/work/esp32/build/board_feed.js build
```

After loading the feature application on the P4, provision it once from a private local terminal while the USB bridge and monitor are closed. Both prompts suppress echo. The tool waits for the panel to acknowledge a single NVS write in its `hemel` namespace. Restart the panel after the acknowledgement. On the tested panel, a restart with the Mac bridge stopped brought the Wi-Fi live cards back in 12 seconds. The same command replaces the saved network. The build and firmware binary contain no Wi-Fi credentials.

```sh
esp32/build/board-tools/bin/python esp32/crowpanel-p4/provision.py /dev/cu.wchusbserial10
```

The horn follows real entries in R13143 (Down fast), R13144 (Up fast), R15145 (Down slow) and R15146 (Up slow). Down plays 554 Hz on the left for 650 ms, leaves a 140 ms gap, then plays 370 Hz on the right for 800 ms. Up exchanges the speakers. Both notes use a short ramp and a quiet second harmonic. The peak sample is 2,861 out of 32,768 (about −21 dBFS). Each fresh arrival retains its direction, including opposing trains entering together. The flash replay, USB recordings, initial area snapshots, reconnect baselines, approaches, service lookups and rotating cards are silent. The updated live USB bridge can send arrival directions as an optional checksummed line immediately after an H1 frame. Older bridges still supply display frames.

### Electrical references for the 10.1-inch V1.2

- The V1.2 drawing identifies IC1 as ESP32-C6-MINI-1-N4. Elecrow's station example and saved IDF configuration select ESP-Hosted four-bit SDIO, slot 1, 40 MHz, CLK 18, CMD 19, D0–D3 17/16/15/14 and C6 EN/reset 32. The descriptive comment above the example mentions 54, but its V1.2 macro, the saved IDF config and the schematic net all specify 32. The P4 build pins the host and remote Wi-Fi versions used by the vendor AI example. [V1.2 station pin definitions](https://github.com/Elecrow-RD/CrowPanel-Advanced-10.1inch-ESP32-P4-HMI-AI-Display-1024x600-IPS-Touch-Screen/blob/1408f16feabf76ae6172a0a8d59e014441cfa13b/example/V1.2/Arduino_Code/Lesson15-WiFi_function/ESP32_P4-station/board_config.h) · [Vendor IDF settings](https://github.com/Elecrow-RD/CrowPanel-Advanced-10.1inch-ESP32-P4-HMI-AI-Display-1024x600-IPS-Touch-Screen/blob/1408f16feabf76ae6172a0a8d59e014441cfa13b/example/V1.2/AI_Conversation/7inch_9inch_10inch_P4_HMI_AI/sdkconfig)
- Elecrow's V1.2 playback example drives I²S1 in Philips stereo mode at 16 kHz, 16 bits, with LRCLK 21, BCLK 22, DOUT 23, no MCLK and active-low amp enable on 30. Its product revision notes identify the early audio stage as NS4168. The published 10.1-inch V1.2 schematic marks both NS4168 positions NC and also shows an ES8311/NS4263B path. The firmware follows the revision-specific playback example. Facing the tested board, the listener heard high left then low right for both the Tring-bound 2T63 and the Euston-bound 1Y60. The PCM test confirms that the firmware swaps I²S slots between directions. Physical channel routing still needs an isolated-speaker check. The amplifier is muted and the I²S clocks stop between entries. [Playback driver and header](https://github.com/Elecrow-RD/CrowPanel-Advanced-10.1inch-ESP32-P4-HMI-AI-Display-1024x600-IPS-Touch-Screen/tree/1408f16feabf76ae6172a0a8d59e014441cfa13b/example/V1.2/idf-code/Lesson12-Playing_Loca_Music_from_SD_Card/peripheral/bsp_audio) · [Product revision notes](https://github.com/Elecrow-RD/CrowPanel-Advanced-10.1inch-ESP32-P4-HMI-AI-Display-1024x600-IPS-Touch-Screen/blob/1408f16feabf76ae6172a0a8d59e014441cfa13b/readme.md) · [V1.2 board schematic](https://github.com/Elecrow-RD/CrowPanel-Advanced-10.1inch-ESP32-P4-HMI-AI-Display-1024x600-IPS-Touch-Screen/tree/1408f16feabf76ae6172a0a8d59e014441cfa13b/Eagle_SCH%26PCB/1.2)

Run `node esp32/standalone/test.mjs` after installing the Node dependencies. It exercises the bundled on-device feed, including direction, all four berths, stale data, sequence gaps and reconnects. The desktop CTest suite also measures both PCM channels and runs the card and touch regressions. On the board, check C6 association and recovery, verify the LCD and touch under TLS load, and listen for the two speaker directions during confirmed station entries.
