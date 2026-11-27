# Transport Display

Transport Display runs live transport maps on a 10.1-inch Elecrow CrowPanel and in a browser. The tablet core runs four independently installable apps. The signed directory lists the versions available for download.

[created by rjp44](https://github.com/rjp44/trains)

| App | What it shows |
| --- | --- |
| [Hemel rail monitor](https://transport.pickering.org/apps/hemel/) | Live trains, signals and booked calls around Hemel Hempstead and Watford Junction, with three recorded journeys through the diagram. |
| [Lakes Transit](https://transport.pickering.org/apps/lakes/) | Lake District buses, coastal trains and the Lancaster–Carlisle WCML on a relief map. Avanti, TransPennine Express and Lumo trains have their own liveries. |
| [Crewe to Birmingham International](https://transport.pickering.org/apps/crewe-birmingham/) | Scrollable Up and Down berth diagram via Stafford, Wolverhampton and Birmingham New Street. Includes mapped signal indications around Birmingham. |
| [Preston to Crewe](https://transport.pickering.org/apps/preston-crewe/) | Scrollable Up and Down berth diagram via Wigan North Western, Warrington Bank Quay and Winsford. |

## Get the apps

The public site opens the app directory. Choose **Open in browser** for any route. Each map has Settings at the top left and a sun/moon button at the top right. **App** holds views, filters and replay controls. **Downloads** lets you search the directory, save another app for offline use, check for updates and remove a saved copy. The bundled recordings work offline after the browser finishes downloading the app.

In **Display**, choose **Sunrise / sunset** to follow the active map’s UK location or adjust map brightness. **Sound** controls train horns, **Wi-Fi** reports browser connectivity, and **About** credits the data sources. [App directory](https://transport.pickering.org/apps/) · [Machine-readable directory](https://transport.pickering.org/directory.json)

On a commissioned tablet, connect to Wi-Fi in **Settings**, then open **Downloads** (**Apps** on core 0.9.5 and earlier). From core 0.9.6, opening Downloads checks both firmware and app versions in the background. **Directory** shows each app's download size and flash space, and the header shows remaining capacity. **Installed** lets you open or delete apps offline. **About** shows versions, data credits and a QR link to this repository. [Hardware, commissioning and OTA](firmware/core/README.md)

## Run locally

Use Node.js 22.4 or newer. From the repository root, install the dependencies and run the development server for the app you want.

```sh
npm ci --prefix esp32
npm ci --prefix lakes
node server.mjs
# In another terminal, or separately
node lakes/server.mjs
```

Hemel listens on port 8174. Lakes listens on port 8186 and uses Python for its local bus-data reader. Both new corridor apps are included in the static build. For the public app directory and signed PWAs, run `node build-preview.mjs`. Netlify publishes the resulting `dist/` and proxies the live HTTP endpoints. [Hemel guide](apps/hemel/README.md) · [Lakes guide](lakes/README.md) · [WCML panels](web/corridor/README.md) · [Tests and simulator](tests/conformance/README.md)

## How a release works

The core owns the touchscreen, Wi-Fi, app storage and updater. Each app package contains a manifest, data, attribution and tables for one of the core’s renderers. A new app can reuse a renderer. Adding a renderer requires a core update. A browser app verifies the same signed package and uses its web renderer. The release key stays with the publisher. Netlify deploys the public catalogue and content-addressed files committed under `releases/`. [Package format](packages/app-format/README.md) · [Publishing guide](firmware/core/README.md#publishing-a-release)

The core version lives in `firmware/core/VERSION`. Each app owns the version in `apps/<id>/app.json`. Change the component that ships. Release tags identify the source and signed catalogue for each rollout.

## Licence and credits

The project's original software is licensed under the GNU General Public License, version 3 only (SPDX `GPL-3.0-only`). Third-party software, rail mappings, map tiles, timetable data, terrain and fonts retain their respective licences and attribution. [GPLv3 licence](LICENSE) · [Hemel credits](apps/hemel/credits.md) · [Lakes credits](apps/lakes/credits.md)
