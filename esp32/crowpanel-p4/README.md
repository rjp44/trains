# Physical Hemel panel

This build targets the **Elecrow CrowPanel Advanced 10.1-inch ESP32-P4, PCB V1.2, 1024×600**. The image has been cross-compiled with ESP-IDF 5.5.3 for P4 silicon revisions 1.0–1.99. Match the PCB marking, chip revision and panel before programming. The vendor's V1.2 display example supplies the 900 Mbit/s two-lane DSI timings, EK79007 initialization, backlight on GPIO31 and GT911 touch wiring. The shared Hemel component supplies the diagram, touch actions, replay and stream decoder. [Elecrow V1.2 display example](https://github.com/Elecrow-RD/CrowPanel-Advanced-10.1inch-ESP32-P4-HMI-AI-Display-1024x600-IPS-Touch-Screen/tree/1408f16feabf76ae6172a0a8d59e014441cfa13b/example/V1.2/idf-code/Lesson09-LVGL_Lighting_Control)

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

With the matching ESP-IDF 5.5.3 environment and Node.js 22.4+ on PATH, run `idf.py -C esp32/crowpanel-p4 build` from the repository root. The component manager resolves the locked LCD, touch and LVGL versions. A Docker build can generate the header on the host with `node esp32/pack.mjs 1024 600 panel_assets.h` and pass the **container-visible** absolute header path as `-DPANEL_PREPACKED=...`. The C3 emulator uses its own bootloader and display driver.

Once the board identity, recovery image and first write are confirmed, flash the board-specific build using `idf.py -C esp32/crowpanel-p4 -p "$PORT" flash monitor` on a host with serial access. A native esptool can also use the board build's `flash_args` file from its build directory. The UART should print `Sector +5s drawn at 1024x600`. Verify that the LCD shows the four WCML lines, the DC and Abbey branches, and the 2N71 Hemel card. Tap a station label, a train badge, a signal and the theme button to check touch orientation across the panel.

## Feed the panel over USB

Close the serial monitor and install the Node dependencies with `npm ci --prefix esp32 --ignore-scripts`. These commands start the bridge separately, first with a recording and then with the public live feed. Stop each session with Ctrl+C.

```sh
"$PY" esp32/usb_bridge.py "$PORT" --recording hemel --at 90
"$PY" esp32/usb_bridge.py "$PORT" --recording watford --at 110
"$PY" esp32/usb_bridge.py "$PORT"
```

The bridge forwards unchanged protocol bytes at 115200 baud, displays board diagnostics, and starts a new full snapshot when the same device path reconnects. Select the **Hemel** view for 1A80 and 2K65, then **Watford** for the Abbey shuttle at Garston. To check loss and recovery without cutting board power, stop the bridge for seven seconds, look for **Link lost**, and restart it. A physical cable removal can also power-cycle a USB-powered panel.
