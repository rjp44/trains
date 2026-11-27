# WCML train-describer panels

[Crewe to Birmingham International](https://transport.pickering.org/apps/crewe-birmingham/) covers 20 reporting locations via Stafford, Wolverhampton and Birmingham New Street. [Preston to Crewe](https://transport.pickering.org/apps/preston-crewe/) covers 15 via Wigan North Western and Warrington Bank Quay.

Read the route from left to right. Each train description occupies its own signalling berth, identified underneath by its train-describer area and berth number. Up moves point right and Down moves point left. A berth reported in both directions appears once on an Up / Down row. The diagrams distinguish Fast, Slow, platform or local line where the source identifies it. A plain Up or Down row means the movement direction is known but the track name is unspecified.

Drag horizontally to follow the line. On the tablet, tap the bottom scroll bar or either Stop control to jump. In the browser use the Location selector, scroll bar or arrow keys. Tap a location name for its berth register, or a train for its service and running information when available. The same headcode can occupy adjacent berths during a movement.

The Birmingham panel shows individually mapped signal indications around New Street and east to International. Tap a signal for its identity, address and reported state. A disconnected area keeps the last-known train positions and clears its signal indications.

Settings → App selects the full route, either section or seven minutes of recorded movements. Pinch to open the section under your fingers or return to the full route. The tablet and browser read the same diagram and recording from the signed app package. The automatic theme follows Wolverhampton or Warrington.

SMART describes individual reporting steps. The importer reads the Up arrival/departure events (A/B), Down arrival/departure events (C/D), and line codes at each end. In each station block, the thin horizontal guides group like berths and the heavier links show reported steps along a lane. Unmapped stretches have no inferred connections. These are schematic reporting diagrams with partial signalling coverage. [SMART field definitions](https://wiki.openraildata.com/index.php/Reference_Data#SMART:_Berth_Stepping_Data) · [Leyland source records](https://vaildata.uk/api/bplan/loc/LEYLAND)

## Updating the maps

The ordered reporting locations are in [the corridor builder](../../tools/build-wcml-corridors.mjs). Run the builder with Node.js to fetch the SMART mappings from VailData and the pinned EASMData Birmingham signal diagram. It also accepts a directory containing cached TIPLOC JSON responses and the pinned newstreet.json file. Generated layouts and recordings live under apps/crewe-birmingham/data and apps/preston-crewe/data. Each app owns its release version and attribution. [Package format](../../packages/app-format/README.md)
