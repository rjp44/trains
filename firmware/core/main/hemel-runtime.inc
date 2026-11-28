// Owned for the lifetime of the mounted package. Strings refer to its parsed tables.
constexpr int panelWidth = 1024, panelHeight = 600;
int markerCount;
uint32_t layoutFingerprint, darkPalette[20], lightPalette[20];
std::vector<MarkerInfo> markerInfo;
std::vector<Card> cards;
std::vector<Detail> details;
std::vector<OperatorTag> operatorTags;
uint8_t labelMode = 0;
struct StationOffset { const char *id,*name; int x; };
struct TrackLegend { int from, to, y; const char *name; };
struct Header {
    unsigned label;
    int primary, secondary, optional;
};
struct ViewTables {
    bool camera=false;
    float request=1, defaultZoom=1;
    int focus=0;
    rail::Axis axis;
    std::vector<Header> headers;
    std::vector<int> signalOffsets, labelY, labelShift;
    int drawnWidth() const { return axis.ready()?axis.width():width; }
    int projected(int x) const { return std::lround(axis.project(x)); }
    int width = panelWidth, pan = 0, legendWidth = 0;
    int viewportWidth() const { return panelWidth - legendWidth; }
    std::vector<TrackLegend> legend;
    std::vector<StationOffset> stations;
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
struct WatchStation { const char *id, *name; std::vector<unsigned> markers; };
std::vector<WatchStation> watchStations;
int watchNumber(const char *id);
void indexStationPaint(ViewTables &view, bool regional) {
    if (watchStations.empty()) return;
    for (auto &label : view.labels) {
        if (!label.preset) continue;
        if (regional) {
            for (size_t i = 0; i < watchStations.size(); ++i)
                if (!strcmp(label.text, watchStations[i].name)) { label.station = i + 1; break; }
        } else {
            label.station = label.preset < 3 ? 1 + watchNumber(label.preset == 1 ? "HML" : "WFJ") : label.preset - 2;
        }
        if (label.station && label.background == HemelBand) label.background = Board;
    }
    // Older packages stored the default station colour in the geometry.
    // Link their named WCML stripes and the identifiable Hemel/Junction stripes at mount.
    for (auto &line : view.lines) {
        if (line.station || line.x1 != line.x2) continue;
        if (line.ink != StationBand && line.ink != HemelBand && line.ink != JunctionBand) continue;
        if (regional && line.width < 24) continue; // Junction throats have separate shading.
        if (!regional && line.ink == HemelBand) line.station = 1 + watchNumber("HML");
        else if (!regional && line.ink == JunctionBand) line.station = 1 + watchNumber("WFJ");
        else for (const auto &label : view.labels)
            if (label.station && label.x == line.x1) { line.station = label.station; break; }
        if (line.ink == HemelBand) {
            line.ink = StationBand;
            if (regional) line.width = 24;
        }
    }
}
int stationCentre(const ViewTables &v,const StationOffset &s) {
    for(const auto &label:v.labels) if(label.preset && !strcmp(label.text,s.name)) return label.x;
    return s.x;
}
bool loadHemel() {
    using namespace transport;
    if (!value(field(tables, "layoutFingerprint"), layoutFingerprint) ||
        !load(
            "markerInfo", markerInfo,
            [](auto p, MarkerInfo &m) { return row(p, m.id, m.signal, m.bit, m.track); }, 1024) ||
        !load("cards", cards,
              [](auto p, Card &c) { return row(p, c.head, c.context, c.route, c.running, c.identity); }) ||
        !load("details", details, [](auto p, Detail &d) {
            d.label = "";
            return cJSON_GetArraySize(p) == 3 ? row(p, d.service, d.route, d.running)
                                              : row(p, d.service, d.route, d.running, d.label);
        }))
        return false;
    operatorTags.clear();
    if (field(tables, "operatorTags") && !load("operatorTags", operatorTags, [](auto p, OperatorTag &tag) {
            return row(p, tag.code, tag.name, tag.background, tag.foreground) &&
                   strlen(tag.code) == 2 && strlen(tag.name) >= 1 && strlen(tag.name) <= 3 &&
                   tag.background <= 0xffffff && tag.foreground <= 0xffffff;
        }, 128)) return false;
    markerCount = markerInfo.size();
    watchStations.clear();
    if(field(tables,"watchStations") && !load("watchStations",watchStations,[](auto row,WatchStation &s){
        auto list=cJSON_GetArrayItem(row,2);
        if(!value(cJSON_GetArrayItem(row,0),s.id) || !value(cJSON_GetArrayItem(row,1),s.name) || !cJSON_IsArray(list)) return false;
        for(auto item=list->child;item;item=item->next) {
            unsigned i;
            if(!value(item,i) || i>=markerInfo.size()) return false;
            s.markers.push_back(i);
        }
        return true;
    },250)) return false;
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
                      if (cJSON_GetArraySize(p) == 7)
                          return row(p, a.x1, a.y1, a.x2, a.y2, a.ink, a.width, a.station) &&
                                 a.ink < 20 && a.station && a.station <= watchStations.size();
                      a.station = 0;
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
        if (auto width = field(tables,key("Width").c_str())) {
            if (!value(width,v.width) || v.width<panelWidth || v.width>32767 ||
                !load(key("Stations").c_str(),v.stations,[&](auto p,StationOffset &stop) {
                    return row(p,stop.id,stop.name,stop.x) && stop.x>=0 && stop.x<v.width;
                },256) || v.stations.front().x!=0) return false;
            for (size_t j=1;j<v.stations.size();++j) if(v.stations[j].x<=v.stations[j-1].x) return false;
            if (auto legendWidth = field(tables, key("LegendWidth").c_str())) {
                if (!value(legendWidth, v.legendWidth) || v.legendWidth < 1 || v.legendWidth > panelWidth / 4 ||
                    !load(key("Legend").c_str(), v.legend, [&](auto p, TrackLegend &l) {
                        return row(p, l.from, l.to, l.y, l.name) && l.from >= 0 && l.from < l.to &&
                               l.to <= v.width && l.y >= 0 && l.y < panelHeight;
                    }, 1024)) return false;
            }
        }
        if (auto camera=field(tables,key("Camera").c_str())) {
            auto headers=field(camera,"headers");
            if(v.stations.empty() || !cJSON_IsArray(headers) || !cJSON_GetArraySize(headers) ||
                cJSON_GetArraySize(headers)>int(v.labels.size()) || !value(field(camera,"focus"),v.focus) ||
                v.focus<0 || v.focus>v.width || !value(field(camera,"zoom"),v.request) || v.request<0 || v.request>3) return false;
            std::vector<bool> seen(v.labels.size());
            for(auto h=headers->child;h;h=h->next){
                Header item{};
                if(!row(h,item.label,item.primary,item.secondary,item.optional) || item.label>=v.labels.size() ||
                    seen[item.label] || item.primary<0 || item.primary>=600 || item.secondary<0 || item.secondary>=600 ||
                    (item.optional<0 || item.optional>2)) return false;
                seen[item.label]=true;
                v.headers.push_back(item);
            }
            v.defaultZoom=v.request;
            v.camera=true;
        }
        indexStationPaint(v, regionalLayout());
        if(!v.stations.empty()) v.pan=std::clamp(stationCentre(v,v.stations.front())-v.viewportWidth()/2,0,v.width-v.viewportWidth());
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
        // Reserve a toolbar in every installed layout. Drawing and hit testing share these coordinates.
        auto diagramY = [](int y) { return toolbarHeight + y * (panelHeight - toolbarHeight) / panelHeight; };
        for (auto &line : v.lines) { line.y1 = diagramY(line.y1); line.y2 = diagramY(line.y2); }
        for (auto &label : v.labels) label.y = diagramY(label.y);
        for (auto &h:v.headers) { h.primary=diagramY(h.primary); h.secondary=diagramY(h.secondary); }
        for (auto &label : v.legend) label.y = diagramY(label.y);
        for (auto &marker : v.markers) { marker.y = diagramY(marker.y); marker.signalY = diagramY(marker.signalY); }
        for (auto *card : {&s.fast, &s.slow}) { card->top = diagramY(card->top); card->bottom = diagramY(card->bottom); }
        s.lines = span(v.lines);
        s.markers = span(v.markers);
        s.labels = span(v.labels);
        r.changes = span(v.changes);
        r.frames = span(v.frames);
    }
    return true;
}
