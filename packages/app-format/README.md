# Transport Display app packages

A `.tda` file starts with the four ASCII bytes `TDA2`, a little-endian 32-bit section count and a directory of 96-byte entries. Each entry contains a zero-padded 48-byte section name, four little-endian 32-bit fields (offset, stored length, decoded length and codec), and a 32-byte SHA-256 of the stored section. Codec 0 stores raw bytes and codec 1 uses zlib deflate. The readers check names, contiguous offsets, bounds, checksums and decoded lengths. Packages hold up to 32 sections and fit in a single 0x270000-byte tablet app partition.

The compiler reads `apps/<id>/app.json` and `credits.md`, adds the project licence, then bundles the app's browser data and native assets. Hemel uses the `hemel-corridor/1` adapter and Lakes uses `lakes-map/1`. The manifest carries the ID, display name, description, adapter, defaults and version. [App compiler](../compiler/app.mjs) · [Browser archive reader](archive.mjs) · [Tablet package reader](../../firmware/core/main/package.cpp)

## Versions and verification

Authors use a stable `major.minor.patch` version. The packaged manifest and signed entry contain the human-readable `versionName` and the numeric `version` used by older OTA clients. Its value is `major × 1,000,000 + minor × 1,000 + patch`. For example, 0.9.0 is 9000 and 0.10.0 is 10000. Minor and patch are each 0–999. Valid new release codes are 9000 through 2147483646. Earlier build numbers keep their original ordering and remain installable when compatible. `minCore` uses the same numeric comparison.

The schema-2 catalogue contains a base64 payload and an ECDSA signature over its decoded bytes. The payload identifies the board and records the version, minimum core, length and SHA-256 of each artifact. App records also include the adapter, name and description. A per-app signed descriptor permits independent browser installation. The public `directory.json` presents sizes and links for browsing. The clients verify the signed records and package bytes before use. [Public directory](https://transport.pickering.org/directory.json)
