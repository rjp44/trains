# Transport Display

Transport Display runs live transport maps on a 10.1-inch Elecrow CrowPanel and in a browser. Release **0.9.0** includes the tablet core and two independently installable apps. Made for Jack with love from @rjp44.

| App | What it shows |
| --- | --- |
| [Hemel rail monitor](https://transport.pickering.org/apps/hemel/) | Live trains, signals and booked calls around Hemel Hempstead and Watford Junction, with three recorded journeys through the diagram. |
| [Lakes Transit](https://transport.pickering.org/apps/lakes/) | Lake District buses and trains on a relief map, with route filters, stop timetables and recorded journeys. |

## Get the apps

Open the public directory to search by name or description. Each browser app can be installed from its own page. After an online installation, its recorded data works offline. The site root still opens the full-window Hemel diagram. [App directory](https://transport.pickering.org/apps/) · [Machine-readable directory](https://transport.pickering.org/directory.json)

On a commissioned tablet, connect to Wi-Fi in **Settings**, then open **Apps → Directory**. Each entry shows its download size and flash space, and the header shows remaining capacity. Download the apps you want. **Installed** lets you open or delete them offline. A firmware update appears here when available. **About** shows the running versions, data credits and a QR link to this repository. [Hardware, commissioning and OTA](firmware/core/README.md)

## Run locally

Use Node.js 22.4 or newer. From the repository root, install the dependencies and run the development server for the app you want.

```sh
npm ci --prefix esp32
npm ci --prefix lakes
node server.mjs
# In another terminal, or separately
node lakes/server.mjs
```

Hemel listens on port 8174. Lakes listens on port 8186 and uses Python for its local bus-data reader. For a static build of the public app directory and signed PWAs, run `node build-preview.mjs`. Netlify publishes the resulting `dist/` and proxies the live HTTP endpoints. [Hemel guide](apps/hemel/README.md) · [Lakes guide](lakes/README.md) · [Tests and simulator](tests/conformance/README.md)

## How a release works

The core owns the touchscreen, Wi-Fi, app storage and updater. Each app package contains a manifest, data, attribution and tables for one of the core’s renderers. A new app can reuse a renderer. Adding a renderer requires a core update. A browser app verifies the same signed package and uses its web renderer. The release key stays with the publisher. Netlify deploys the public catalogue and content-addressed files committed under `releases/`. [Package format](packages/app-format/README.md) · [Publishing guide](firmware/core/README.md#publishing-a-release)

The core version lives in `firmware/core/VERSION`. Each app owns the version in `apps/<id>/app.json`. Change the component that ships. The Git tag `v0.9.0` identifies the source for this combined release.

## Licence and credits

The project's original software is licensed under the GNU General Public License, version 3 only (SPDX `GPL-3.0-only`). Third-party software, rail mappings, map tiles, timetable data, terrain and fonts retain their respective licences and attribution. [GPLv3 licence](LICENSE) · [Hemel credits](apps/hemel/credits.md) · [Lakes credits](apps/lakes/credits.md)
