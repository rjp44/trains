# Station pair replay format, version 1

A TDP1 package describes one station, two opposing tracks and one recorded train with a booked call. Both players implement the capability `station-pair-replay/1`. The source is JSON. It contains `manifest`, `scene`, `replay` and a repository-relative `licenceFile`. The compiler validates field types, limits and references and copies the licence bytes into the package. The ordered record definitions are in [format.mjs](format.mjs). The checked-in [Hemel definition](../../apps/hemel/overlay.json) is a complete example.

## Drawing and replay

The logical viewport is 1024 × 600 landscape pixels. Coordinates start at the top left. Each berth refers to a track ID. Its centre is `station.x + berth.offsetX` at `track.y`. A station berth has offset zero. The card rectangle has an independent top-left anchor, width and height. Players draw the station band, tracks and platform marks, train badge, then the eligible card. Fonts are platform-specific. The conformance test compares the position, colour, size and text of every drawing command.

Each replay row describes the one train's state from its timestamp until the next change. Time is integer milliseconds from the recording origin. The first row at zero seeds the state silently. A blank berth means the train has left the displayed area. A matching timetable identity (`matched = 1`) makes this booked service eligible on an approach. An occupied station berth also shows a card while identity is unknown. An outbound berth clears the card. The timing string carries the legacy card's recorded operator and timing observation, including any update while the train stands at Hemel.

A change into a station berth after the baseline records a station-entry event with its source timestamp, track direction and booked status at entry. Subsequent observations at that berth retain the same event. Seeking reconstructs the last event at or before the cursor. Recorded events are silent, consistent with the existing panel's horn policy. This capability represents one already observed booked working. Live TD sequencing, service matching and multi-train arbitration remain in the original app.

## Wire layout

| Bytes | Contents |
| --- | --- |
| 0–3 | ASCII `TDP1` |
| 4–51 | Four entries, each three little-endian uint32s holding absolute offset, byte length and standard CRC-32 of the section |
| 52 onward | Consecutive manifest, scene, replay and licence sections in that order |

Numeric field widths and signedness are specified in the schema. Strings in the typed sections have a uint8 byte length followed by up to 250 printable ASCII bytes. Lists have a uint8 count followed by records in array order. The licence is a verbatim file. A package can contain up to 32 berths and 128 ordered replay rows and occupies at most 65,536 bytes including the directory. Both readers check the directory, section checksums, capability, references and drawing bounds before replacing the current scene.

The compiler emits the same bytes for identical data, regardless of JSON indentation or object key order. The CRC detects corruption in a local development transfer. Release signing, staging, rollback and persistent installation belong to the update milestone.
