# WCML train-describer panels

[Crewe to Birmingham International](https://transport.pickering.org/apps/crewe-birmingham/) covers 20 reporting locations via Stafford, Wolverhampton and Birmingham New Street. [Preston to Crewe](https://transport.pickering.org/apps/preston-crewe/) covers 15 via Wigan North Western and Warrington Bank Quay.

Read the overview down each column, from the first station to the last. A headcode marks a train occupying a mapped signalling berth at or near the named location. Tap a headcode for its service, operator, running times and delay when the relay supplies a unique match. Tap a location to inspect the individual berths and known platforms. Dispatchers can reuse a headcode and a train can occupy adjacent berths during a move.

The Birmingham panel has individual signal indications around New Street and east to International. Tap a signal for its identity, address and most-restrictive, less-restrictive or unknown state. Other locations show berth occupancy. A quiet or disconnected area keeps last-known train positions and clears its signal indications.

Settings → App selects the whole route, either section or seven minutes of movements recorded on 27 November 2026. Pinch the overview to open a section. Both tablet and browser use the same signed package, Network Rail SMART berth associations and Signal Maps feed. The automatic theme follows Wolverhampton or Warrington.

## Updating the maps

The ordered reporting locations are in [the corridor builder](../../tools/build-wcml-corridors.mjs). Run the builder with Node.js to fetch the SMART mappings from VailData and the pinned EASMData Birmingham signal diagram. It also accepts a directory containing cached TIPLOC JSON responses and the pinned newstreet.json file. Generated layouts and recordings live under apps/crewe-birmingham/data and apps/preston-crewe/data. Each app owns its release version and attribution. [Package format](../../packages/app-format/README.md)
