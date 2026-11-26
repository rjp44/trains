# Lakes Transit

From the checkout root run `node lakes/server.mjs` and open [the portrait map](http://127.0.0.1:8186/). The prototype needs Node.js 22.4+ and Python 3. The Python standard library reads the DfT archive. All map assets and the recording are included.

The map fills the viewport on launch with all ten routes visible. Tap a route chip to focus it, then add or remove routes by tapping their chips. **All** restores the overview. The crosshair fits the visible routes. The dashboard button opens the stop finder, Live/Replay switch and other controls. Vehicle icons grow to 2.4 times their overview size as you zoom in. Use + and − to zoom, drag to pan and tap a vehicle for its source and timestamp age. The removable detail card stays inside the map. The vehicle list gives a second way to inspect crowded stops. Light and dark themes are saved on the device.

Choose **Replay** for snapshots captured on 25 November 2026. The snapshots advance every five seconds and show the original London time. Pause or use the slider to inspect a frame. Positions jump only when there is another observation. The first frame contains all eight bus routes, a Lakes Line train and three coastal trains.

## Bus timetables

The 505, 508 and 516 share a green-and-white single-decker icon. The 555 uses a blue-and-green double-decker and the 599 a lime-green open-top double-decker. The chevron points along the bus’s published journey. The map averages about 430 m of road on each side of the marker to smooth small turns. Buses use a roof view from 315° through north to 45°, and from 135° through south to 205°. The 599 shows its exposed upper-deck seats. Other bearings use an upright side profile. Tap a bus to open its scheduled stops. The list opens at the next call by timetable and scrolls back to the origin. Times use the London clock and ≈ marks an approximate scheduled time. A live bus needs a unique matching stop pattern for its route, service day, booked departure time and origin and destination stop codes.

Tap a white stop circle for the next three scheduled boarding departures in each onward direction. Each row gives the service number, destination and boarding side or stand where available. Zoom for more circles or use **Find a stop**. Stop boards include departures for the selected bus routes. Selecting a bus or stop pauses replay and uses the recorded time. For an example serving both sides of a road, select **Hayes Garden Centre, Ambleside** in the first replay frame.

The X4 and X5 use the double-decker symbol and the X6 uses the single-decker symbol. These are route symbols, so they stay consistent across vehicle substitutions.

The bundled winter extract covers 24 November 2026 through 21 March 2027. It includes eight Stagecoach routes, daily service calendars and date exceptions from BODS, plus NaPTAN stop names and roadside information. Its 565 boarding and alighting points appear in 340 map locations. Stops with matching names and localities are grouped within 220 m. Differently named poles can share a board when they serve a common route on the same street, face opposing directions and are mutually nearest within 120 m. Their individual boarding names appear beside departures. [DfT regional GTFS download](https://data.bus-data.dft.gov.uk/timetable/download/gtfs-file/north_west/) · [DfT NaPTAN stop extract](https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv&atcoAreaCodes=090,250)

To refresh the timetable, download both extracts above as `north_west.zip` and `naptan.csv`. Run `python3 lakes/tools/build-timetable.py north_west.zip naptan.csv --until 2027-03-21 --map-cache /tmp/lakes-map-downloads` with Python 3.11 or newer. This also writes the selected bus road traces to the map cache and refreshes the live-feed coverage. Run the map build below using the same cache. Set the end date to the last day covered by the route map edition. When moving to a new edition, keep a timetable covering the replay's service dates or refresh the replay with observations from the new edition.

## Coverage

The map includes the road geometry of the published winter route variants. A bus starts at its reported coordinates. If icons overlap, the map spaces buses along their own journey paths, in journey order. Trains keep their feed positions. On crowded overviews, bus icons can shrink to fit. Zoom in for a closer view. The detail panel and timetable still refer to the original observation. A single-carriage Northern icon shows the estimated train position, with its yellow cab facing the next station along the railway. The **Lakes** chip follows Oxenholme Lake District, Kendal, Burneside, Staveley and Windermere. **Coast** follows all 27 stations from Lancaster to Barrow-in-Furness on the Furness Line and onward to Whitehaven on the Cumbrian Coast Line. Zoom or select Coast for the smaller stations. The dashed final section marks the Bransty Tunnel closure in the November 2026 edition. Northern runs replacement buses between Corkickle and Whitehaven. [Northern service update](https://www.northernrailway.co.uk/engineering/branstytunnel)

| Route | Winter coverage |
| --- | --- |
| 505 | Windermere and Ambleside to Hawkshead and Coniston. Selected journeys extend to Kendal or serve the school. |
| 555 | Keswick–Grasmere–Windermere–Kendal, including shorter workings. The display ends at central Kendal. |
| 599 | Bowness–Windermere–Ambleside–Grasmere, with shorter workings. |
| 516 | Ambleside and Great Langdale to Old Dungeon Ghyll. Selected journeys extend to Windermere and Kendal. |
| 508 | Penrith–Pooley Bridge–Glenridding–Patterdale. The winter map ends at Patterdale. Stagecoach lists the Windermere extension for the summer timetable from 22 March 2027. |
| X4 | A66 corridor between Workington, Cockermouth, Keswick and Penrith, including the Bassenthwaite village variant. |
| X5 | A66 corridor between Workington, Cockermouth, Keswick and Penrith, including shorter workings. |
| X6 | A590 corridor between Kendal, Grange-over-Sands, Ulverston and Barrow-in-Furness. |

The winter timetables include different stopping patterns by day. Christmas Day, Boxing Day and New Year’s Day have exceptions. The guide publishes special services for the 555 and 599 on Boxing Day and New Year’s Day. The map describes the winter edition checked on 25 November 2026. [Stagecoach winter guide, pages 31–56 and 71–72](https://tiscon-maps-stagecoachbus.s3.amazonaws.com/Timetables/Cumbria/Lakes%20Connection/Winter26/Lakes_by_Bus_Winter26_WEB.pdf)

## Running data

- **Bus GPS.** The local server downloads the public DfT BODS SIRI-VM bulk ZIP at most once per minute while clients request data. It streams the XML through a local filter for operator SCCU, the eight published route numbers and monitored journeys. It uses the latest `RecordedAtTime` per vehicle, checks coordinates against each route’s extent and uses reported journey endpoints to distinguish the 555 and X4 workings in scope and returns only the local records to the browser. The national ZIP was about 2.5 MB during verification. A local relay or the authenticated, geographically filtered BODS API would suit a standalone panel with a smaller network budget. [Public snapshot](https://data.bus-data.dft.gov.uk/avl/download/bulk_archive) · [DfT location data specification](https://www.gov.uk/government/publications/technical-guidance-publishing-location-data-using-the-bus-open-data-service-siri-vm/technical-guidance-siri-vm)
- **Rail estimates.** The server polls Railinfo’s public train map at most once per 30 seconds. It matches reported legs to the ordered stations of each railway, including services that skip stops. On the shared Lancaster–Carnforth approach it also checks for a coastal terminus. A named junction without a station code can qualify for a coastal working within about 500 m of the route. The map uses the coordinates supplied by Railinfo. The displayed age is the age of Railinfo’s generated estimate. The popout gives its last reported and next expected station times. A train dwelling at a terminus can disappear while the feed has no qualifying leg. [Railinfo API](https://api.railinfo.uk/docs) · [Train map data](https://api.railinfo.uk/map/trains)
- **Freshness.** The server shares in-flight requests and cached snapshots. Recent retained vehicles are dimmed during a source failure or after two minutes of age. Fixes expire after ten minutes. A successful feed with zero vehicles has its own state. Replay uses the recorded clock for these checks.

Both integrated endpoints worked without accounts on 25 November 2026. To inspect the compact local feed while the server is running, open [the local snapshot](http://127.0.0.1:8186/api/vehicles).

## Geographic assets and attribution

- Bus paths use the BODS regional GTFS road shapes for the displayed Stagecoach trips. Shared edges are joined before simplification at approximately ten metres. Alternating colours show the services using each shared road segment. [DfT North West GTFS](https://data.bus-data.dft.gov.uk/timetable/download/gtfs-file/north_west/)
- Water, road and rail geometry is derived from © OpenStreetMap contributors, available under ODbL, via OpenFreeMap and © OpenMapTiles. Both railways follow connected track checked against their ordered station locations from Railinfo. The map build includes the Bransty Tunnel centreline from OpenStreetMap. [Tunnel geometry](https://www.openstreetmap.org/way/5940205) The bundled map data and rebuild script provide the local geographic extract. [OSM attribution and licence](https://www.openstreetmap.org/copyright) · [OpenFreeMap](https://openfreemap.org/) · [OpenMapTiles](https://openmaptiles.org/) · [Railinfo station locations](https://api.railinfo.uk/stations/geo)
- The shaded terrain is derived from Mapzen Terrain Tiles, accessed on 25 November 2026. The local rendering includes 100 m contour shading. [Terrain dataset](https://registry.opendata.aws/terrain-tiles/) · [Mapzen source attribution and licences](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)
- Contains public sector information supplied through BODS under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

The projection is local equirectangular, with longitude scaled at 54.35°N. Routes, terrain, labels, stations, fixes and the scale bar use that common geographic frame. Relative east–west scale variation is below 1% across the display.

For a map-data refresh, use a Python environment with `mapbox-vector-tile`, `shapely`, `numpy` and `Pillow`. Run `python lakes/tools/build-map.py /tmp/lakes-map-downloads`. The directory caches the source downloads. Build the timetable into that cache first. Use a fresh directory to retrieve a new tile edition and review the published service period before replacing the winter coverage. Runtime and tests do not need those libraries.

Run `node --test` from the checkout root. The [CrowPanel ESP32-P4 firmware](esp32/README.md) uses the same map, timetable and public live feed.

## Browser installation and live hosting

Open the Lakes app from the public directory. After its first online installation, the service worker caches a verified package, map, timetable and recordings for offline use. Live vehicle positions need a network connection. [Open Lakes Transit](https://transport.pickering.org/apps/lakes/)

The standalone Lakes Netlify project hosts the live vehicle function at `/api/vehicles`. The main Transport Display site proxies that endpoint, and the tablet fetches it directly from the Lakes host. Its separate build runs in this directory with `npm ci` and `node build-pwa.mjs`, using `netlify.toml` and the functions under `functions/`. The combined app directory and signed downloads build from the repository root. [Public directory](https://transport.pickering.org/apps/) · [Tablet assets](esp32/README.md)
