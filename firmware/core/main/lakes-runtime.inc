int rasterW, rasterH, rasterX, rasterY, mapW, mapH, firstDay;
float rasterScale;
double west, north, units, aspect;
uint8_t *terrain, *advances, *fontMask;
uint16_t *dayPalette, *nightPalette, *sprites;
std::vector<Route> routes;
std::vector<XY> vertices;
std::vector<Segment> segments;
std::vector<Place> places;
std::vector<Group> groups;
std::vector<Stop> stops;
std::vector<Call> calls;
std::vector<Pattern> patterns;
std::vector<Trip> trips;
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
              [](auto p, Stop &a) { return row(p, a.ref, a.group, a.side) && a.group < groups.size(); }) ||
        !load("calls", calls,
              [](auto p, Call &a) {
                  return row(p, a.stop, a.arrival, a.departure, a.pickup, a.exact) && a.stop < stops.size();
              }) ||
        !load("patterns", patterns,
              [](auto p, Pattern &a) {
                  return row(p, a.offset, a.count) && a.count && a.offset < calls.size() &&
                         a.count <= calls.size() - a.offset;
              }) ||
        !load("calendar", calendar, str) || !load("recordings", recordings, str, 100) ||
        !load("trips", trips, [](auto p, Trip &a) {
            return row(p, a.route, a.service, a.start, a.pattern, a.dest) &&
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
        size_t(rasterW) * rasterH > 5 * 1024 * 1024 || !std::isfinite(rasterScale) || rasterScale <= 0 ||
        atlas.size != 24 + 4 * colors + 95 * (1 + 19 * 23) + 7 * 48 * 48 * 2)
        return false;
    dayPalette = (uint16_t *)(p + 24);
    nightPalette = dayPalette + colors;
    advances = (uint8_t *)(nightPalette + colors);
    fontMask = advances + 95;
    sprites = (uint16_t *)(fontMask + 95 * 19 * 23);
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
