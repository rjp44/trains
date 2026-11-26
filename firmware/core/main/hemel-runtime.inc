// Owned for the lifetime of the mounted package. Strings refer to its parsed tables.
constexpr int panelWidth = 1024, panelHeight = 600;
int markerCount;
uint32_t layoutFingerprint, darkPalette[20], lightPalette[20];
std::vector<MarkerInfo> markerInfo;
std::vector<Card> cards;
std::vector<Detail> details;
struct ViewTables {
    std::vector<Segment> lines;
    std::vector<Label> labels;
    std::vector<Marker> markers;
    std::vector<Change> changes;
    std::vector<Frame> frames;
};
ViewTables viewTables[3];
Scene sectorScene{}, hemelScene{}, watfordScene{};
Recording sectorRecording{}, hemelRecording{}, watfordRecording{};
template <class T> List<T> span(const std::vector<T> &v) { return {v.data(), v.size()}; }
bool loadHemel() {
    using namespace transport;
    if (!value(field(tables, "layoutFingerprint"), layoutFingerprint) ||
        !load(
            "markerInfo", markerInfo,
            [](auto p, MarkerInfo &m) { return row(p, m.id, m.signal, m.bit, m.track); }, 1024) ||
        !load("cards", cards,
              [](auto p, Card &c) { return row(p, c.head, c.context, c.route, c.running, c.identity); }) ||
        !load("details", details, [](auto p, Detail &d) { return row(p, d.service, d.route, d.running); }))
        return false;
    markerCount = markerInfo.size();
    for (int i = 0; i < 2; i++) {
        auto a = field(tables, i ? "lightPalette" : "darkPalette");
        if (cJSON_GetArraySize(a) != 20)
            return false;
        for (int j = 0; j < 20; j++)
            if (!value(cJSON_GetArrayItem(a, j), (i ? lightPalette : darkPalette)[j]))
                return false;
    }
    Scene *scenes[] = {&sectorScene, &hemelScene, &watfordScene};
    Recording *recordings[] = {&sectorRecording, &hemelRecording, &watfordRecording};
    const char *names[] = {"sector", "hemel", "watford"};
    for (int i = 0; i < 3; i++) {
        auto &v = viewTables[i];
        auto &s = *scenes[i];
        auto &r = *recordings[i];
        auto key = [&](const char *suffix) { return std::string(names[i]) + suffix; };
        if (!load(key("Lines").c_str(), v.lines,
                  [](auto p, Segment &a) {
                      return row(p, a.x1, a.y1, a.x2, a.y2, a.ink, a.width) && a.ink < 20;
                  }) ||
            !load(key("Labels").c_str(), v.labels,
                  [](auto p, Label &a) {
                      return row(p, a.x, a.y, a.width, a.font, a.ink, a.background, a.text, a.preset) &&
                             a.ink >= 0 && a.ink < 20 && a.background < 20;
                  }) ||
            !load(key("Markers").c_str(), v.markers,
                  [](auto p, Marker &a) {
                      return row(p, a.id, a.x, a.y, a.signalY, a.radius) && a.id < markerCount;
                  }) ||
            !load(key("Changes").c_str(), v.changes,
                  [](auto p, Change &a) {
                      return row(p, a.id, a.aspect, a.kind, a.head, a.detail) && a.id < markerCount &&
                             a.detail < details.size();
                  }) ||
            !load(key("Frames").c_str(), v.frames,
                  [&](auto p, Frame &a) {
                      auto c = cJSON_GetArrayItem(p, 2);
                      return cJSON_GetArraySize(p) == 3 && value(cJSON_GetArrayItem(p, 0), a.ms) &&
                             value(cJSON_GetArrayItem(p, 1), a.end) && a.end <= v.changes.size() &&
                             row(c, a.cards[0], a.cards[1], a.cards[2], a.cards[3]) &&
                             std::all_of(std::begin(a.cards), std::end(a.cards),
                                         [](unsigned n) { return n < cards.size(); });
                  }) ||
            !value(field(tables, key("Duration").c_str()), r.duration) || !r.duration)
            return false;
        auto space = field(tables, key("Space").c_str());
        auto rect = [&](int j, CardSpace &a) {
            return row(cJSON_GetArrayItem(space, j), a.centre, a.left, a.top, a.bottom) && a.left >= 0 &&
                   a.left < panelWidth - 8 && a.bottom >= a.top;
        };
        if (!rect(0, s.fast) || !rect(1, s.slow) || !value(cJSON_GetArrayItem(space, 2), s.badgeWidth) ||
            !value(cJSON_GetArrayItem(space, 3), s.badgeHeight))
            return false;
        for (size_t j = 1; j < v.frames.size(); j++)
            if (v.frames[j].end < v.frames[j - 1].end || v.frames[j].ms < v.frames[j - 1].ms)
                return false;
        s.lines = span(v.lines);
        s.markers = span(v.markers);
        s.labels = span(v.labels);
        r.changes = span(v.changes);
        r.frames = span(v.frames);
    }
    return true;
}
