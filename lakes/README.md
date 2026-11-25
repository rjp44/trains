# Lake District transport map

From the checkout root run `node lakes/server.mjs` and open [the portrait map](http://127.0.0.1:8186/). The prototype needs Node.js 22.4+ and Python 3. The Python standard library reads the DfT archive. All map assets and the recording are included.

The map opens live. Select a route to fit it to the panel, or select it again to return to the overview. Use + and − to zoom, drag to pan and tap a vehicle for its source and timestamp age. The removable detail card stays inside the map. The vehicle list gives a second way to inspect crowded stops. Light and dark themes are saved on the device.

Choose **Replay** for snapshots captured on 25 November 2026. The snapshots advance every five seconds and show the original London time. Pause or use the slider to inspect a frame. Positions jump only when there is another observation. The first frame contains all five bus routes and a Lakes Line train approaching Oxenholme from Kendal.

## Bus timetables

The 505, 508 and 516 share a green-and-white single-decker icon. The 555 uses a blue-and-green double-decker and the 599 a lime-green open-top double-decker. Each icon and its route-coloured chevron point along the last reported GPS bearing. A front-on bus indicates an unavailable bearing. Tap a bus to open its scheduled stops. The list opens at the next call by timetable and scrolls back to the origin. Times use the London clock and ≈ marks an approximate scheduled time. A live bus needs a unique matching stop pattern for its route, service day, booked departure time and origin and destination stop codes.

Tap a white stop circle for the next three scheduled boarding departures in each onward direction. Each row gives the service number, destination and boarding side or stand where available. Zoom for more circles or use **Find a stop**. Selecting a route filters the stop boards. Selecting a bus or stop pauses replay and uses the recorded time. For an example serving both sides of a road, select **Hayes Garden Centre, Ambleside** in the first replay frame.

The bundled winter extract covers 24 November 2026 through 21 March 2027. It includes Stagecoach's five routes, daily service calendars and date exceptions from BODS, plus NaPTAN stop names and roadside information. Its 369 boarding and alighting points appear in 221 map locations. Stops with matching names and localities are grouped within 220 m. Differently named poles can share a board when they serve a common route on the same street, face opposing directions and are mutually nearest within 120 m. Their individual boarding names appear beside departures. [DfT regional GTFS download](https://data.bus-data.dft.gov.uk/timetable/download/gtfs-file/north_west/) · [DfT NaPTAN stop extract](https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv&atcoAreaCodes=090,250)

To refresh the timetable, download both extracts above as `north_west.zip` and `naptan.csv`. Run `python3 lakes/tools/build-timetable.py north_west.zip naptan.csv --until 2027-03-21` with Python 3.11 or newer. Set the end date to the last day covered by the route map edition. When moving to a new edition, keep a timetable covering the replay's service dates or refresh the replay with observations from the new edition.

## Coverage

The map includes the road geometry of the published winter route variants. Each fix is plotted at its reported coordinates. The branch includes Oxenholme Lake District, Kendal, Burneside, Staveley and Windermere.

| Route | Winter coverage |
| --- | --- |
| 505 | Windermere and Ambleside to Hawkshead and Coniston. Selected journeys extend to Kendal or serve the school. |
| 555 | Lancaster–Kendal–Windermere–Grasmere–Keswick, including shorter workings and a separate Sunday timetable. |
| 599 | Bowness–Windermere–Ambleside–Grasmere, with shorter workings. |
| 516 | Ambleside and Great Langdale to Old Dungeon Ghyll. Selected journeys extend to Windermere and Kendal. |
| 508 | Penrith–Pooley Bridge–Glenridding–Patterdale. The winter map ends at Patterdale. Stagecoach lists the Windermere extension for the summer timetable from 22 March 2027. |

The five services have daily winter timetables, with individual journeys restricted to particular days. Christmas Day, Boxing Day and New Year’s Day have exceptions. The guide publishes special services for the 555 and 599 on Boxing Day and New Year’s Day. The map describes the winter edition checked on 25 November 2026. [Stagecoach winter guide, pages 31–56 and 71–72](https://tiscon-maps-stagecoachbus.s3.amazonaws.com/Timetables/Cumbria/Lakes%20Connection/Winter26/Lakes_by_Bus_Winter26_WEB.pdf)

## Running data

- **Bus GPS.** The local server downloads the public DfT BODS SIRI-VM bulk ZIP at most once per minute while clients request data. It streams the XML through a local filter for operator SCCU, the five published route numbers and monitored journeys. It uses the latest `RecordedAtTime` per vehicle, checks coordinates against the map extent and returns only the local records to the browser. The national ZIP was about 2.5 MB during verification. A local relay or the authenticated, geographically filtered BODS API would suit a standalone panel with a smaller network budget. [Public snapshot](https://data.bus-data.dft.gov.uk/avl/download/bulk_archive) · [DfT location data specification](https://www.gov.uk/government/publications/technical-guidance-publishing-location-data-using-the-bus-open-data-service-siri-vm/technical-guidance-siri-vm)
- **Rail estimates.** The server polls Railinfo’s public train map at most once per 30 seconds. It accepts positions whose last and next stations both belong to the Lakes Line. Through trains qualify on their branch leg. A WCML service calling at Oxenholme alone does not qualify. The displayed age is the age of Railinfo’s generated estimate. The popout gives its last reported and next expected station times. A train dwelling at a terminus can disappear while the feed has no qualifying leg. [Railinfo API](https://api.railinfo.uk/docs) · [Train map data](https://api.railinfo.uk/map/trains)
- **Freshness.** The server shares in-flight requests and cached snapshots. Recent retained vehicles are dimmed during a source failure or after two minutes of age. Fixes expire after ten minutes. A successful feed with zero vehicles has its own state. Replay uses the recorded clock for these checks.

Both integrated endpoints worked without accounts on 25 November 2026. To inspect the compact local feed while the server is running, open [the local snapshot](http://127.0.0.1:8186/api/vehicles).

## Geographic assets and attribution

- Bus paths use the Track/Mapping coordinates of Stagecoach Cumbria TransXChange 2.4 RouteLinks. The November 2026 archive supplied seven relevant timetable files, including three registrations for the 555. Paths are simplified at approximately ten metres and deduplicated. Alternating colours depict exact road links shared by routes. [Stagecoach Open Data](https://www.stagecoachbus.com/open-data)
- Water, road and rail geometry is derived from © OpenStreetMap contributors, available under ODbL, via OpenFreeMap and © OpenMapTiles. The Windermere branch follows connected rail geometry checked against five station coordinates from Railinfo. The bundled map data and rebuild script provide the local geographic extract. [OSM attribution and licence](https://www.openstreetmap.org/copyright) · [OpenFreeMap](https://openfreemap.org/) · [OpenMapTiles](https://openmaptiles.org/) · [Railinfo station locations](https://api.railinfo.uk/stations/geo)
- The shaded terrain is derived from Mapzen Terrain Tiles, accessed on 25 November 2026. The local rendering includes 100 m contour shading. [Terrain dataset](https://registry.opendata.aws/terrain-tiles/) · [Mapzen source attribution and licences](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)
- Contains public sector information supplied through BODS under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

The projection is local equirectangular, with longitude scaled at 54.35°N. Routes, terrain, labels, stations, fixes and the scale bar use that common geographic frame. Relative east–west scale variation is below 1% across the display.

For a map-data refresh, use a Python environment with `mapbox-vector-tile`, `shapely`, `numpy` and `Pillow`. Run `python lakes/tools/build-map.py /tmp/lakes-map-downloads`. The directory caches the source downloads. Use a fresh directory to retrieve a new timetable or tile edition and review the published service period before replacing the winter coverage. Runtime and tests do not need those libraries.

Run `node --test` from the checkout root. A future ESP32 port can consume the same compact local API and generated map coordinates.
