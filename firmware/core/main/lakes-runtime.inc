int rasterW, rasterH, rasterX, rasterY, mapW, mapH, firstDay;
float rasterScale;
double west, north, units, aspect;
uint8_t *terrain, *advances, *fontMask;
uint16_t *dayPalette, *nightPalette, *sprites;
const uint16_t *nightSprites;
const uint8_t *nightOpacity;
constexpr unsigned nightSide = 64;
unsigned spriteCount;
struct RailLivery { const char *name; unsigned side; };
std::map<std::string_view, RailLivery> railLiveries;

// The signed table lists one family of four views per operator, in atlas order.
bool loadRailLiveries(const cJSON *families) {
    unsigned side = bus::railAtlasFrames;
    for (auto family = families->child; family; family = family->next, side += 4) {
        const char *name = cJSON_GetStringValue(cJSON_GetArrayItem(family, 0));
        if (!cJSON_IsArray(family) || !name || !*name) return false;
        for (auto alias = family->child; alias; alias = alias->next) {
            const char *code = cJSON_GetStringValue(alias);
            if (!code || !*code || !railLiveries.emplace(code, RailLivery{name, side}).second) return false;
        }
    }
    return true;
}
int railAsset(std::string_view agency) {
    if (railLiveries.empty()) return bus::railSideAsset(agency, spriteCount);
    auto match = railLiveries.find(agency);
    return match != railLiveries.end() ? int(match->second.side) : 3;
}
std::vector<Route> routes;
std::vector<XY> vertices;
std::vector<Segment> segments;
std::vector<Place> places;
std::vector<Group> groups;
std::vector<Stop> stops;
std::vector<Call> calls;
std::vector<Pattern> patterns;
std::vector<Trip> trips;
std::vector<bus::Path> busPaths;
std::vector<Variant> busVariants;
std::vector<const char *> calendar, recordings;
bool loadLakes() {
    using namespace transport;
    auto f = field(tables, "frame");
    if (!value(field(f, "width"), mapW) || !value(field(f, "height"), mapH) || mapW <= 0 || mapH <= 0 ||
        !value(field(f, "west"), west) || !value(field(f, "north"), north) ||
        !value(field(f, "units"), units) || !value(field(f, "aspect"), aspect) ||
        !value(field(tables, "firstDay"), firstDay) || units <= 0 || aspect <= 0)
        return false;
    auto at = [](auto p, int i) -> const cJSON * { return cJSON_GetArrayItem(p, i); };
    auto point = [](auto p, XY &a) { return row(p, a.x, a.y); };
    auto str = [](auto p, const char *&s) { return value(p, s); };
    if (!load(
            "routes", routes, [](auto p, Route &r) { return row(p, r.key, r.name, r.rgb, r.icon); }, 30) ||
        !load("vertices", vertices, point) ||
        !load("segments", segments,
              [](auto p, Segment &s) {
                  return row(p, s.offset, s.count, s.mask, s.closed) && s.offset <= vertices.size() &&
                         s.count <= vertices.size() - s.offset && s.count >= 2;
              }) ||
        !load("places", places,
              [&](auto p, Place &a) {
                  return value(at(p, 0), a.name) && point(at(p, 1), a.point) && value(at(p, 2), a.route) &&
                         a.route >= -1 && a.route < int(routes.size()) && value(at(p, 3), a.code) &&
                         value(at(p, 4), a.vertex);
              }) ||
        !load("groups", groups,
              [&](auto p, Group &a) {
                  return value(at(p, 0), a.name) && value(at(p, 1), a.town) && point(at(p, 2), a.point) &&
                         value(at(p, 3), a.mask);
              }) ||
        !load("stops", stops,
              [](auto p, Stop &a) { return (row(p, a.ref, a.group, a.side, a.name) || row(p, a.ref, a.group, a.side)) && a.group < groups.size(); }) ||
        !load("calls", calls,
              [](auto p, Call &a) {
                  return (row(p, a.stop, a.arrival, a.departure, a.pickup, a.exact, a.dropoff) ||
                          row(p, a.stop, a.arrival, a.departure, a.pickup, a.exact)) && a.stop < stops.size();
              }) ||
        !load("patterns", patterns,
              [](auto p, Pattern &a) {
                  return row(p, a.offset, a.count) && a.count && a.offset < calls.size() &&
                         a.count <= calls.size() - a.offset;
              }) ||
        !load("calendar", calendar, str) || !load("recordings", recordings, str, 100) ||
        !load("trips", trips, [](auto p, Trip &a) {
            return (row(p, a.route, a.service, a.start, a.pattern, a.dest, a.path) ||
                    row(p, a.route, a.service, a.start, a.pattern, a.dest)) &&
                   unsigned(a.route) < routes.size() && unsigned(a.service) < calendar.size() &&
                   unsigned(a.pattern) < patterns.size();
        }))
        return false;
    auto atlas = unpack("native/atlas.bin");
    if (atlas.size < 24)
        return false;
    auto p = atlas.data;
    rasterW = little(p);
    rasterH = little(p + 4);
    rasterX = int32_t(little(p + 8));
    rasterY = int32_t(little(p + 12));
    memcpy(&rasterScale, p + 16, 4);
    unsigned colors = little(p + 20);
    if (!colors || colors > 256 || rasterW <= 0 || rasterH <= 0 || rasterW > 4096 || rasterH > 4096 ||
        size_t(rasterW) * rasterH > 5 * 1024 * 1024 || !std::isfinite(rasterScale) || rasterScale <= 0)
        return false;
    const size_t artHeader = 24 + 4 * colors + 95 * (1 + 19 * 23);
    const size_t spriteBytes = 48 * 48 * 2;
    if (atlas.size < artHeader) return false;
    const size_t artBytes = atlas.size - artHeader;
    const size_t pairedBytes = spriteBytes + 3 * nightSide * nightSide;
    railLiveries.clear();
    auto families = field(tables, "railLiveries");
    if (families) {
        if (!cJSON_IsArray(families) || artBytes % pairedBytes) return false;
        const size_t frames = artBytes / pairedBytes;
        if (frames < bus::railAtlasFrames || (frames - bus::railAtlasFrames) % 4 ||
            (frames - bus::railAtlasFrames) / 4 != size_t(cJSON_GetArraySize(families)) ||
            !loadRailLiveries(families)) return false;
    }
    const bool hasNight = families || artBytes == 13 * pairedBytes ||
        artBytes == bus::railAtlasFrames * pairedBytes || artBytes == bus::operatorAtlasFrames * pairedBytes;
    const size_t frameBytes = hasNight ? pairedBytes : spriteBytes;
    if (artBytes % frameBytes) return false;
    spriteCount = artBytes / frameBytes;
    const size_t dayEnd = artHeader + spriteCount * spriteBytes;
    const size_t nightPixels = spriteCount * nightSide * nightSide;
    if (spriteCount == 10 || spriteCount == 13 || hasNight) {
        auto raw = unpack("native/bus-paths.bin");
        if (raw.size < 4) return false;
        unsigned pathCount = little(raw.data);
        if (!pathCount || pathCount > 4096) return false;
        size_t offset = 4;
        for (unsigned i = 0; i < pathCount; ++i) {
            if (raw.size - offset < 4) return false;
            unsigned n = little(raw.data + offset);
            offset += 4;
            if (n < 2 || n > (raw.size - offset) / sizeof(bus::Vertex)) return false;
            auto points = reinterpret_cast<const bus::Vertex *>(raw.data + offset);
            if (points[0].distance != 0) return false;
            for (unsigned j = 1; j < n; ++j)
                if (!std::isfinite(points[j].distance) || points[j].distance <= points[j-1].distance ||
                    (points[j].x == points[j-1].x && points[j].y == points[j-1].y)) return false;
            busPaths.push_back({points, n});
            offset += n * sizeof(bus::Vertex);
        }
        if (offset != raw.size) return false;
        for (const auto &t : trips) {
            if (unsigned(t.path) >= pathCount) return false;
            auto pattern = patterns[t.pattern];
            Variant v{t.route, t.path, calls[pattern.offset].stop, calls[pattern.offset + pattern.count - 1].stop};
            if (std::none_of(busVariants.begin(), busVariants.end(), [&](auto &other) {
                return other.route == v.route && other.path == v.path && other.origin == v.origin && other.terminus == v.terminus;
            })) busVariants.push_back(v);
        }
    } else if (spriteCount != 7) return false;
    dayPalette = (uint16_t *)(p + 24);
    nightPalette = dayPalette + colors;
    advances = (uint8_t *)(nightPalette + colors);
    fontMask = advances + 95;
    sprites = (uint16_t *)(fontMask + 95 * 19 * 23);
    nightSprites = hasNight ? reinterpret_cast<const uint16_t *>(p + dayEnd) : nullptr;
    nightOpacity = hasNight ? p + dayEnd + 2 * nightPixels : nullptr;
    auto tiles = unpack("native/terrain.tiles");
    const unsigned nx = (rasterW + 127) / 128, ny = (rasterH + 127) / 128, index = nx * ny * 8;
    if (tiles.size < index)
        return false;
    terrain = (uint8_t *)heap_caps_malloc(size_t(rasterW) * rasterH, MALLOC_CAP_SPIRAM);
    auto *scratch = (uint8_t *)heap_caps_malloc(128 * 128, MALLOC_CAP_SPIRAM);
    if (!terrain || !scratch)
        return false;
    size_t end = index;
    for (unsigned y = 0; y < ny; y++)
        for (unsigned x = 0; x < nx; x++) {
            auto e = tiles.data + (y * nx + x) * 8;
            unsigned n = little(e + 4), w = std::min(128, rasterW - int(x * 128)),
                     h = std::min(128, rasterH - int(y * 128));
            if (little(e) != end - index || n > tiles.size - end ||
                !inflate(tiles.data + end, n, scratch, w * h) ||
                *std::max_element(scratch, scratch + w * h) >= colors)
                return false;
            for (unsigned j = 0; j < h; j++)
                memcpy(terrain + (y * 128 + j) * rasterW + x * 128, scratch + j * w, w);
            end += n;
        }
    free(scratch);
    free(tiles.data);
    return end == tiles.size;
}
