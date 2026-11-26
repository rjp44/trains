# Lakes tablet renderer

The shared CrowPanel core builds the DSI display driver, Lakes map renderer, HTTPS vehicle client and Settings display in `main/`. The physical display is 1024 × 600. Lakes can rotate the map to portrait. Wi-Fi, brightness and sound are shared with Hemel. [CrowPanel build and installation](../../firmware/core/README.md)

The app compiler runs `pack.mjs` for the map, timetable and replay tables, `pack-art.py` for the terrain, sprites and glyphs, and `terrain-tiles.py` for compressed terrain tiles. Build the package from the repository root with Node, Python with Pillow, and librsvg's `rsvg-convert` on the path.

```sh
node packages/compiler/app.mjs lakes /tmp/lakes.tda
```

Set `ART_PYTHON` to the Python executable with Pillow if needed. The core loads these assets from the installed package. The native rail-event tests exercise the report transitions that drive the horn. [Lakes data and asset sources](../README.md) · [Test commands](../../tests/conformance/README.md)
