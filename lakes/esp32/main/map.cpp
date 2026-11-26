#include "map.h"
#include "settings_display.h"
#include "settings_ui.h"
#include "toolbar.h"
#include "esp_timer.h"
#include "preferences.h"
#include "rail_events.h"
#include "bus_layout.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <iterator>
#include <map>
#include <tuple>
#include <utility>

#include "rows.h"
#include "view-settings.h"
#include "esp_heap_caps.h"
namespace lakes {
namespace {
struct XY {
    int16_t x, y;
};
struct Route {
    const char *key, *name;
    uint32_t rgb;
    const char *icon;
};
struct Segment {
    unsigned offset, count, mask;
    bool closed;
};
struct Place {
    const char *name;
    XY point;
    int route;
    const char *code;
    unsigned vertex;
};
struct Group {
    const char *name, *town;
    XY point;
    unsigned mask;
};
struct Stop {
    const char *ref;
    unsigned group;
    const char *side;
};
struct Call {
    unsigned stop;
    int arrival, departure;
    bool pickup, exact;
};
struct Pattern {
    unsigned offset, count;
};
struct Trip {
    int route, service, start, pattern;
    const char *dest;
    int path = -1;
};
struct Variant { int route, path; unsigned origin, terminus; };
#include "lakes-runtime.inc"

uint16_t *pixels;
int W = 600, H = 1024;
bool portrait = true, dark = false, dirty = true, liveFailed = false, manualReplay = false,
     haveLive = false;
uint32_t updated = 0, lastDraw = 0, replayAt = 0;
int replayFrame = 0, count = 0, page = 0, stopSelection = -1;
std::string selection;
Snapshot latest, recorded;
unsigned mask = 0;
float zoom = 1, cx = mapW * .5f, cy = mapH * .5f;
int top, bottom;
float scale;
enum Action {
    Marker,
    BusStop,
    Close,
    Back,
    More
};
struct Rect {
    int x, y, w, h;
};
struct Hit {
    Rect box;
    Action action;
    int index;
};
std::vector<Hit> hits;
uint16_t ink, paper, edge, muted;
uint16_t color(unsigned v) { return ((v >> 8) & 0xf800) | ((v >> 5) & 0x07e0) | ((v >> 3) & 0x001f); }
uint16_t blend(uint16_t bg, uint16_t fg, int a) {
    auto part = [&](int mask, int shift) {
        return ((((bg >> shift) & mask) * (255 - a) + ((fg >> shift) & mask) * a) / 255) << shift;
    };
    return part(31, 11) | part(63, 5) | part(31, 0);
}
int offset(int x, int y) { return portrait ? x * panelWidth + panelWidth - 1 - y : y * panelWidth + x; }
void pixel(int x, int y, uint16_t c) {
    if (unsigned(x) < unsigned(W) && unsigned(y) < unsigned(H))
        pixels[offset(x, y)] = c;
}
void rect(int x, int y, int w, int h, uint16_t c) {
    const int left = std::max(0, x), right = std::min(W, x + w), up = std::max(0, y),
              down = std::min(H, y + h);
    if (left >= right || up >= down)
        return;
    if (portrait)
        for (int i = left; i < right; i++)
            std::fill_n(pixels + offset(i, down - 1), down - up, c);
    else
        for (int j = up; j < down; j++)
            std::fill_n(pixels + offset(left, j), right - left, c);
}
bool overlaps(Rect a, Rect b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
int textWidth(const std::string &s) {
    int n = 0;
    for (unsigned char c : s)
        if (c >= 32 && c < 127)
            n += advances[c - 32];
    return n;
}
void text(int x, int y, const std::string &s, uint16_t c, int limit = 2000) {
    int end = x + limit;
    for (unsigned char ch : s) {
        if (ch < 32 || ch >= 127)
            continue;
        const int glyph = ch - 32, w = advances[glyph];
        if (x + w > end)
            break;
        auto alpha = fontMask + glyph * 19 * 23;
        for (int j = 0; j < 23; j++)
            for (int i = 0; i < std::min(19, w + 1); i++) {
                const int a = alpha[j * 19 + i], xx = x + i, yy = y + j;
                if (a && unsigned(xx) < unsigned(W) && unsigned(yy) < unsigned(H)) {
                    auto &p = pixels[offset(xx, yy)];
                    p = a == 255 ? c : blend(p, c, a);
                }
            }
        x += w;
    }
}
void tag(Rect box, const std::string &name, uint16_t fill, uint16_t fg, Action action, int index = -1) {
    rect(box.x, box.y, box.w, box.h, edge);
    rect(box.x + 1, box.y + 1, box.w - 2, box.h - 2, fill);
    text(box.x + std::max(3, (box.w - textWidth(name)) / 2), box.y + (box.h - 20) / 2, name, fg, box.w - 4);
    hits.push_back({box, action, index});
}
bool visible(int r) { return !mask || (mask & (1u << r)); }
int sx(double x) { return std::lround((x - cx) * scale + W * .5); }
int sy(double y) { return std::lround((y - cy) * scale + (top + bottom) * .5); }
void layout() {
    W = portrait ? 600 : 1024;
    H = portrait ? 1024 : 600;
    top = transport::toolbarHeight;
    bottom = H;
    scale = std::min((W - 40.f) / mapW, (bottom - top - 28.f) / mapH) * zoom;
}
void fit() {
    cx = mapW / 2.f;
    cy = mapH / 2.f;
    zoom = 1;
    layout();
    if (!mask)
        return;
    int xmin = 32767, xmax = -32767, ymin = 32767, ymax = -32767;
    for (auto &s : segments)
        if (s.mask & mask)
            for (unsigned i = 0; i < s.count; i++) {
                auto p = vertices[s.offset + i];
                xmin = std::min(xmin, int(p.x));
                xmax = std::max(xmax, int(p.x));
                ymin = std::min(ymin, int(p.y));
                ymax = std::max(ymax, int(p.y));
            }
    cx = (xmin + xmax) / 16.f;
    cy = (ymin + ymax) / 16.f;
    zoom = std::clamp(std::min((W - 50.f) / ((xmax - xmin) / 8.f + 24),
                               (bottom - top - 35.f) / ((ymax - ymin) / 8.f + 24)) /
                          scale,
                      1.f, 20.f);
}
void baseMap() {
    const auto *pal = dark ? nightPalette : dayPalette;
    static int columns[panelWidth];
    for (int x = 0; x < W; x++)
        columns[x] = std::clamp(int((cx + (x - W * .5f) / scale - rasterX) * rasterScale), 0, rasterW - 1);
    static int rows[panelWidth];
    for (int y = top; y < bottom; ++y)
        rows[y] =
            rasterW * std::clamp(int((cy + (y - (top + bottom) * .5f) / scale - rasterY) * rasterScale), 0,
                                 rasterH - 1);
    // Read source rows sequentially, transpose in internal SRAM, then write long
    // contiguous bursts to the inactive PSRAM framebuffer (also in portrait).
    constexpr int block = 16;
    uint16_t tile[block][block];
    for (int y0 = top; y0 < bottom; y0 += block) {
        int ny = std::min(block, bottom - y0);
        for (int x0 = 0; x0 < W; x0 += block) {
            int nx = std::min(block, W - x0);
            for (int j = 0; j < ny; ++j) {
                auto src = terrain + rows[y0 + j];
                if (portrait)
                    for (int i = 0; i < nx; ++i)
                        tile[i][ny - 1 - j] = pal[src[columns[x0 + i]]];
                else
                    for (int i = 0; i < nx; ++i)
                        tile[j][i] = pal[src[columns[x0 + i]]];
            }
            if (portrait)
                for (int i = 0; i < nx; ++i)
                    memcpy(pixels + offset(x0 + i, y0 + ny - 1), tile[i], ny * sizeof(uint16_t));
            else
                for (int j = 0; j < ny; ++j)
                    memcpy(pixels + offset(x0, y0 + j), tile[j], nx * sizeof(uint16_t));
        }
    }
}
void track(int x, int y, int a, int b, const uint16_t *colors, int n, bool rail, bool closed) {
    if (std::max(x, a) < 0 || std::min(x, a) >= W || std::max(y, b) < top || std::min(y, b) >= bottom)
        return;
    int dx = a - x, dy = b - y, len = std::max(abs(dx), abs(dy));
    if (!len)
        return;
    for (int i = 0; i <= len; i++) {
        if (closed && i % 8 >= 4)
            continue;
        const int px = x + dx * i / len, py = y + dy * i / len;
        if (py < top || py >= bottom)
            continue;
        rect(px - 1, py - 1, 3, 3, colors[(i / 5) % n]);
        if (rail && !closed && i % 9 < 4)
            pixel(px, py, color(0xffffff));
    }
}
void network() {
    for (const auto &s : segments) {
        const unsigned owners = mask ? s.mask & mask : s.mask;
        if (!owners)
            continue;
        uint16_t colors[10];
        int n = 0;
        for (unsigned k = 0; k < std::size(routes); k++)
            if (owners & (1u << k))
                colors[n++] = color(routes[k].rgb);
        auto p = std::data(vertices) + s.offset;
        int x = sx(p->x / 8.f), y = sy(p->y / 8.f);
        for (unsigned j = 1; j < s.count; j++) {
            int a = sx(p[j].x / 8.f), b = sy(p[j].y / 8.f);
            track(x, y, a, b, colors, n, owners >= 256, s.closed);
            x = a;
            y = b;
        }
    }
}
std::vector<Rect> occupied;
void geography() {
    occupied.clear();
    for (const auto &p : places) {
        bool major = !strcmp(p.code, "BIF") || !strcmp(p.code, "WTH") || !strcmp(p.code, "LAN") ||
                     !strcmp(p.code, "ULV") || !strcmp(p.code, "GOS");
        if (p.route >= 0 && !major && !visible(p.route))
            continue;
        if (p.route == 9 && !major && zoom < 2 && !(mask & (1 << 9)))
            continue;
        int x = sx(p.point.x / 8.f), y = sy(p.point.y / 8.f);
        if (x < 0 || x >= W || y < top + 3 || y >= bottom - 3)
            continue;
        rect(x - 2, y - 2, 5, 5, ink);
        std::string name = p.name;
        int width = textWidth(name);
        for (int sign : {1, -1}) {
            Rect b{std::clamp(x + 5, 2, std::max(2, W - width - 3)), y + (sign == 1 ? -21 : 2), width + 2,
                   21};
            if (b.y < top || b.y + b.h > bottom ||
                std::any_of(occupied.begin(), occupied.end(), [&](Rect r) { return overlaps(b, r); }))
                continue;
            text(b.x - 1, b.y, name, paper);
            text(b.x + 1, b.y, name, paper);
            text(b.x, b.y + 1, name, paper);
            text(b.x, b.y, name, ink);
            occupied.push_back(b);
            break;
        }
    }
    std::vector<Rect> drawn;
    for (unsigned i = 0; i < std::size(groups); i++) {
        const auto &g = groups[i];
        if (mask && !(g.mask & mask))
            continue;
        int x = sx(g.point.x / 8.f), y = sy(g.point.y / 8.f);
        Rect b{x - 8, y - 8, 17, 17};
        if (x < 0 || x >= W || y < top + 6 || y >= bottom - 6)
            continue;
        if (std::any_of(drawn.begin(), drawn.end(), [&](Rect v) { return overlaps(b, v); }))
            continue;
        rect(x - 3, y - 3, 7, 7, muted);
        rect(x - 2, y - 2, 5, 5, paper);
        drawn.push_back(b);
        hits.push_back({b, BusStop, int(i)});
    }
}
const Snapshot &active() { return manualReplay || !haveLive ? recorded : latest; }
bool replaying() { return manualReplay || !haveLive; }
int64_t clockMs(uint32_t now) { return active().time + (replaying() ? 0 : uint32_t(now - updated)); }
double railAngle(const Vehicle &v) {
    const Place *from = nullptr, *to = nullptr;
    for (const auto &p : places)
        if (p.route == v.route) {
            if (v.lastCode == p.code)
                from = &p;
            if (v.nextCode == p.code)
                to = &p;
        }
    unsigned lo = 0, hi = 65535, base = 0;
    if (from && to) {
        lo = std::min(from->vertex, to->vertex);
        hi = std::max(from->vertex, to->vertex);
    }
    double best = 1e30, angle = 0;
    int dir = v.direction ? v.direction : from && to && to->vertex < from->vertex ? -1 : 1;
    for (const auto &s : segments)
        if (s.mask == (1u << v.route)) {
            for (unsigned i = 1; i < s.count; i++) {
                unsigned end = base + i;
                if (end <= lo || end > hi)
                    continue;
                auto a = vertices[s.offset + i - 1], b = vertices[s.offset + i];
                double dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
                if (!len)
                    continue;
                double rx = v.x * 8 - a.x, ry = v.y * 8 - a.y,
                       t = std::clamp((rx * dx + ry * dy) / len, 0., 1.);
                double e = (rx - t * dx) * (rx - t * dx) + (ry - t * dy) * (ry - t * dy);
                if (e < best) {
                    best = e;
                    angle = atan2(dx * dir, -dy * dir) * 180 / M_PI;
                }
            }
            base += s.count - 1;
        }
    return fmod(angle + 360, 360);
}
void vehicles(uint32_t now) {
    const auto &data = active();
    count = 0;
    float fullSize = std::min(2.4f, 1.f + .35f * log2f(zoom));
    std::vector<bus::Marker> markers;
    for (unsigned i = 0; i < data.vehicles.size(); i++) {
        const auto &v = data.vehicles[i];
        int k = v.route;
        int64_t age = clockMs(now) - v.time;
        if (!visible(k) || age >= 600000 || age < -60000)
            continue;
        count++;
        int x = sx(v.x), y = sy(v.y);
        if (x < -20 || x > W + 20 || y < top - 10 || y > bottom + 10)
            continue;
        float direction = k >= 8 ? railAngle(v) : v.path >= 0 ? bus::bearing(busPaths[v.path], v.along) : v.bearing;
        markers.push_back({i, {float(v.x), float(v.y)}, direction, v.path, v.along});
    }
    std::sort(markers.begin(), markers.end(), [&](const auto &a, const auto &b) {
        return std::tie(a.path, a.distance, data.vehicles[a.index].id) < std::tie(b.path, b.distance, data.vehicles[b.index].id);
    });
    const float unit = fullSize * (48.f / 44) / scale;
    std::vector<bus::Box> footprints;
    auto inside = [&](bus::Point p) { return sx(p.x) >= 0 && sx(p.x) < W && sy(p.y) >= top && sy(p.y) < bottom; };
    const auto anchors = markers;
    float busSize = 1;
    for (float factor : {1.f, .82f, .66f, .52f, .4f}) {
        busSize = factor;
        markers = anchors;
        footprints.clear();
        bool crowded = false;
        for (auto &m : markers) {
            if (!bus::place(m, busPaths, footprints, unit * (m.path < 0 ? 1 : factor), inside)) crowded = true;
            footprints.push_back(m.box);
        }
        if (!crowded) break;
    }
    for (const auto box : footprints) {
        int left = sx(box.x), up = sy(box.y);
        occupied.push_back({left, up, sx(box.x + box.w) - left + 1, sy(box.y + box.h) - up + 1});
    }
    bus::restoreOrder(markers);
    // In exceptional crowds the fixed train also gets the final draw and hit-test priority.
    for (auto it = markers.rbegin(); it != markers.rend(); ++it) {
        const auto &m = *it;
        unsigned i = m.index;
        const auto &v = data.vehicles[i];
        float size = fullSize * (m.path < 0 ? 1 : busSize);
        int k = v.route, x = sx(m.point.x), y = sy(m.point.y);
        double direction = m.bearing;
        int64_t age = clockMs(now) - v.time;
        int asset = k >= 8                                     ? 3
                    : !strcmp(routes[k].icon, "open-decker")   ? 2
                    : !strcmp(routes[k].icon, "closed-decker") ? 1
                                                               : 0;
        bool roof = m.path >= 0 && bus::roofView(direction);
        if (roof) asset += 7;
        else if (direction < 0 && asset < 3) asset += 4;
        double angle = direction < 0 ? 0 : (direction - 90) * M_PI / 180;
        float c = cos(angle) / size, s = sin(angle) / size, flip = !roof && direction > 180 ? -1 : 1;
        bool stale = age >= 120000 || (!replaying() && liveFailed) || !(k >= 8 ? data.railOk : data.busOk);
        int radius = int(24 * size);
        const auto *sprite = sprites + 48 * 48 * asset;
        for (int j = -radius; j <= radius; j++)
            for (int h = -radius; h <= radius; h++) {
                int u = int(24 + h * c + j * s), w = int(24 + (-h * s + j * c) * flip);
                if (unsigned(u) < 48 && unsigned(w) < 48 && sprite[w * 48 + u]) {
                    uint16_t col = sprite[w * 48 + u];
                    pixel(x + h, y + j, stale ? blend(paper, col, 150) : col);
                }
            }
        std::string badge = routes[k].name;
        int width = textWidth(badge) + 7;
        int left = sx(m.box.x), up = sy(m.box.y);
        Rect hit{left, up, sx(m.box.x + m.box.w) - left + 1, sy(m.box.y + m.box.h) - up + 1};
        for (int d : {-1, 1}) {
            Rect b{std::clamp(x + 9, 0, W - width), y + (d < 0 ? -radius - 16 : radius - 3), width, 20};
            if (b.y < top || b.y + 20 > bottom ||
                std::any_of(occupied.begin(), occupied.end(), [&](Rect v) { return overlaps(b, v); }))
                continue;
            rect(b.x, b.y, b.w, b.h, color(routes[k].rgb));
            text(b.x + 3, b.y, badge, color(0xffffff));
            occupied.push_back(b);
            hits.push_back({b, Marker, int(i)});
            break;
        }
        hits.push_back({hit, Marker, int(i)});
    }
}
int dayNumber(int y, int m, int d) {
    y -= m <= 2;
    const int era = y / 400, yr = y - era * 400;
    return era * 146097 + yr * 365 + yr / 4 - yr / 100 + (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1 -
           719468;
}
int dayNumber(const std::string &s) {
    int y, m, d;
    return sscanf(s.c_str(), "%d-%d-%d", &y, &m, &d) == 3 ? dayNumber(y, m, d) : -1;
}
struct Clock {
    int day, second;
};
Clock london(int64_t epoch) {
    time_t t = epoch / 1000;
    tm parts{};
    localtime_r(&t, &parts);
    return {dayNumber(parts.tm_year + 1900, parts.tm_mon + 1, parts.tm_mday),
            parts.tm_hour * 3600 + parts.tm_min * 60 + parts.tm_sec};
}
Clock departure(const std::string &s) {
    int day = dayNumber(s), h, m, sec, oh = 0, om = 0;
    if (day < 0 || s.size() < 19 || sscanf(s.c_str() + 11, "%d:%d:%d", &h, &m, &sec) != 3)
        return {-1, 0};
    int offset = 0;
    if (s.size() > 19 && (s[19] == '+' || s[19] == '-') && sscanf(s.c_str() + 20, "%d:%d", &oh, &om) == 2)
        offset = (oh * 3600 + om * 60) * (s[19] == '+' ? 1 : -1);
    return london((int64_t(day) * 86400 + h * 3600 + m * 60 + sec - offset) * 1000);
}
std::string hhmm(int s) {
    char buf[12];
    snprintf(buf, sizeof(buf), "%02d:%02d", (s / 3600) % 24, (s / 60) % 60);
    return buf;
}
bool runs(const Trip &t, int day) {
    const int d = day - firstDay;
    return d >= 0 && d < int(strlen(calendar[t.service])) && calendar[t.service][d] == '1';
}
const Trip *match(const Vehicle &v) {
    const auto dep = departure(v.departure);
    if (dep.day < 0)
        return nullptr;
    int day = v.serviceDate.empty() ? dep.day : dayNumber(v.serviceDate);
    int sec = (dep.day - day) * 86400 + dep.second;
    const Trip *found = nullptr;
    for (auto &t : trips) {
        if (t.route != v.route || t.start != sec || !runs(t, day))
            continue;
        const auto &p = patterns[t.pattern];
        if (v.origin != stops[calls[p.offset].stop].ref ||
            v.terminus != stops[calls[p.offset + p.count - 1].stop].ref)
            continue;
        if (found && found->pattern != t.pattern)
            return nullptr;
        found = &t;
    }
    return found;
}
void locateBuses(Snapshot &snapshot) {
    if (busPaths.empty()) return;
    for (auto &v : snapshot.vehicles) {
        if (v.route >= 8) continue;
        const bus::Point fix{float(v.x), float(v.y)};
        if (const auto *trip = match(v)) {
            const auto &pattern = patterns[trip->pattern];
            int duration = calls[pattern.offset + pattern.count - 1].arrival;
            auto start = departure(v.departure);
            auto elapsed = london(v.time);
            float expected = duration > 0 ? std::clamp(float((elapsed.day - start.day)*86400 +
                elapsed.second - start.second) / duration, 0.f, 1.f) : -1.f;
            v.path = trip->path;
            v.along = bus::nearest(busPaths[v.path], fix, expected).distance;
            continue;
        }
        int bestRank = -1;
        float bestError = INFINITY;
        for (const auto &variant : busVariants) {
            if (variant.route != v.route) continue;
            int rank = int(v.origin == stops[variant.origin].ref) + int(v.terminus == stops[variant.terminus].ref);
            if (rank < bestRank) continue;
            auto path = busPaths[variant.path];
            auto candidate = bus::nearest(path, fix, -1);
            if (!rank && v.bearing >= 0)
                candidate.error += .6f * (1 - std::cos((bus::bearing(path, candidate.distance) - v.bearing) * bus::radians));
            if (rank > bestRank || candidate.error < bestError) {
                bestRank = rank;
                bestError = candidate.error;
                v.path = variant.path;
                v.along = candidate.distance;
            }
        }
    }
}
std::vector<std::string> details;
std::string title, subtitle;
void fillDetails(uint32_t now) {
    details.clear();
    page = 0;
    Clock clock = london(clockMs(now));
    if (stopSelection >= 0) {
        const auto &g = groups[stopSelection];
        title = g.name;
        subtitle = std::string(g.town) + "  |  Scheduled departures";
        if (clock.day < firstDay || clock.day >= firstDay + int(strlen(calendar[0]))) {
            details.push_back("Outside the loaded timetable dates.");
            return;
        }
        using Row = std::pair<int, std::string>;
        std::map<unsigned, std::vector<Row>> byDirection;
        for (const auto &t : trips) {
            if (!visible(t.route))
                continue;
            const auto &p = patterns[t.pattern];
            for (unsigned i = 0; i + 1 < p.count; i++) {
                const auto &call = calls[p.offset + i];
                const auto &stop = stops[call.stop];
                if (!call.pickup || int(stop.group) != stopSelection)
                    continue;
                unsigned next = i + 1;
                while (next < p.count && int(stops[calls[p.offset + next].stop].group) == stopSelection)
                    next++;
                if (next == p.count)
                    continue;
                auto &v = byDirection[stops[calls[p.offset + next].stop].group];
                for (int day = clock.day - 1; day <= clock.day + 7; day++) {
                    int at = (day - clock.day) * 86400 + t.start + call.departure;
                    if (!runs(t, day) || at < clock.second || at >= clock.second + 7 * 86400)
                        continue;
                    const int delta = at / 86400;
                    std::string prefix = delta ? "+" + std::to_string(delta) + "d " : "";
                    std::string row = prefix + hhmm(at) + "   " + routes[t.route].name + "  " + t.dest +
                                      (stop.side[0] ? "  /  " : "") + stop.side;
                    Row entry{at, row};
                    auto where = std::lower_bound(v.begin(), v.end(), entry);
                    if (where == v.end() || *where != entry)
                        v.insert(where, std::move(entry));
                    if (v.size() > 3)
                        v.pop_back();
                }
            }
        }
        for (auto &[idx, rows] : byDirection)
            if (!rows.empty()) {
                details.push_back(std::string("Towards ") + groups[idx].name);
                for (auto &r : rows)
                    details.push_back(r.second);
            }
        if (details.empty())
            details.push_back("No scheduled departures in the next seven days.");
        return;
    }
    const auto &rows = active().vehicles;
    auto it = std::find_if(rows.begin(), rows.end(), [](auto &v) { return v.id == selection; });
    if (it == rows.end()) {
        selection.clear();
        return;
    }
    auto &v = *it;
    title = std::string(routes[v.route].name) + "  " + (v.route >= 8 ? v.label : "to " + v.destination);
    subtitle = (replaying() ? std::string("Recorded  |  ") : std::string()) +
               (v.route >= 8 ? "Railinfo rail estimate" : "Stagecoach GPS  |  " + v.label);
    if (v.route >= 8) {
        details = {"Last   " + v.last + "   " + v.lastTime, "Next   " + v.next + "   " + v.nextTime};
        return;
    }
    const auto *t = match(v);
    if (!t) {
        details.push_back("No unique match in the published bus timetable.");
        return;
    }
    const auto &p = patterns[t->pattern];
    int next = -1;
    const int day = v.serviceDate.empty() ? departure(v.departure).day : dayNumber(v.serviceDate);
    for (unsigned i = 0; i < p.count; i++) {
        const auto &call = calls[p.offset + i];
        int at = t->start + call.arrival;
        if (next < 0 && at >= clock.second + (clock.day - day) * 86400)
            next = i;
        details.push_back(hhmm(at) + (call.exact ? "   " : " ~ ") + groups[stops[call.stop].group].name);
    }
    if (next >= 0)
        page = next / 5;
}
void card() {
    if (stopSelection < 0 && selection.empty())
        return;
    int y = bottom - 246, margin = 10;
    rect(margin, y, W - 2 * margin, 240, edge);
    rect(margin + 2, y + 2, W - 2 * margin - 4, 236, paper);
    // Consume taps on the card so the map underneath stays put.
    hits.push_back({{margin, y, W - 2 * margin, 240}, Close, -2});
    text(22, y + 8, title, ink, W - 102);
    text(22, y + 32, subtitle, muted, W - 55);
    tag({W - 77, y + 6, 54, 34}, "Close", paper, ink, Close);
    for (int i = 0; i < 5; i++) {
        unsigned row = page * 5 + i;
        if (row >= details.size())
            break;
        text(22, y + 62 + i * 25, details[row], ink, W - 45);
    }
    if (details.size() > 5) {
        tag({22, y + 194, 76, 38}, "Prev", paper, ink, Back);
        text(110, y + 203, std::to_string(page + 1) + " / " + std::to_string((details.size() + 4) / 5),
             muted);
        tag({W - 102, y + 194, 80, 38}, "Next", paper, ink, More);
    }
}
void toolbar(uint32_t now) {
    rect(0, 0, W, top, paper);
    auto clock = london(clockMs(now));
    std::string status = replaying() ? (manualReplay ? "Replay" : "Replay / Wi-Fi") :
        liveFailed ? "Feed offline" : (!latest.busOk || !latest.railOk ? "Partial feed" : "Live");
    status += "  " + hhmm(clock.second) + "  (" + std::to_string(count) + ")";
    text(std::max(60, (W - textWidth(status)) / 2), (top - 23) / 2, status, muted, W - 120);
    transport::drawToolbar(pixels, portrait, dark);
}
void loadFrame() { replayInput(recordings[replayFrame]); }
} // namespace

int routeIndex(const char *s) {
    for (unsigned i = 0; i < std::size(routes); i++)
        if (!strcmp(s, routes[i].key))
            return i;
    return -1;
}
void project(double lon, double lat, double &x, double &y) {
    x = (lon - west) * units * aspect;
    y = (north - lat) * units;
}
void replayInput(const char *json) { if (decode(json, recorded)) locateBuses(recorded); }
bool mountPackage(){
    if(!loadLakes()) return false;
    for(auto json:recordings){Snapshot test;if(!decode(json,test))return false;}
    return true;
}
struct MapSettings {float zoom,x,y;uint32_t mask,portrait,dark;};
void saveView(){ transport::saveView("lakes_view",MapSettings{zoom,cx,cy,mask,portrait,dark}); }
bool portraitView(){return portrait;}
void toggleTheme() {
    dark = !dark;
    dirty = true;
    saveView();
}
void pinch(float ratio, int fromX, int fromY, int toX, int toY) {
    auto logicalX = [&](int x, int y) { return portrait ? y : x; };
    auto logicalY = [&](int x, int y) { return portrait ? panelWidth - 1 - x : y; };
    const float anchorX = cx + (logicalX(fromX, fromY) - W * .5f) / scale;
    const float anchorY = cy + (logicalY(fromX, fromY) - (top + bottom) * .5f) / scale;
    zoom = std::clamp(zoom * ratio, 1.f, 24.f);
    layout();
    cx = std::clamp(anchorX - (logicalX(toX, toY) - W * .5f) / scale, 0.f, float(mapW));
    cy = std::clamp(anchorY - (logicalY(toX, toY) - (top + bottom) * .5f) / scale, 0.f, float(mapH));
    dirty = true;
}
void finishPinch() { saveView(); }

void drawOptions(lv_obj_t *parent) {
    enum Choice : uintptr_t { Live, Replay, Step, ZoomOut, ZoomIn, FitRoutes, Portrait, Landscape, AllRoutes, Route };
    auto choose = [](lv_event_t *e) {
        auto id = reinterpret_cast<uintptr_t>(lv_event_get_user_data(e));
        if (id == Live || id == Replay || id == Step || id >= AllRoutes) {
            selection.clear();
            stopSelection = -1;
            page = 0;
        }
        if (id <= Step) {
            if (id == Step) {
                replayFrame = (replayFrame + 1) % std::size(recordings);
                loadFrame();
            } else manualReplay = id == Replay;
            replayAt = esp_timer_get_time() / 1000;
        } else {
            if (id == Portrait || id == Landscape) portrait = id == Portrait;
            else if (id == ZoomOut) zoom = std::max(1.f, zoom / 1.5f);
            else if (id == ZoomIn) zoom = std::min(24.f, zoom * 1.5f);
            else {
                if (id == AllRoutes) mask = 0;
                if (id >= Route && id - Route < routes.size()) mask ^= 1u << (id - Route);
                fit();
            }
            layout();
            saveView();
        }
        dirty = true;
        panel::refreshAppPage();
    };
    auto row = panel::optionRow(parent, "Data source");
    panel::option(row, "Live", choose, Live, !manualReplay);
    panel::option(row, "Replay", choose, Replay, manualReplay);
    if (manualReplay) panel::option(row, "Next frame", choose, Step);
    char level[32];
    std::snprintf(level, sizeof level, "Map zoom   %.1fx", double(zoom));
    row = panel::optionRow(parent, level);
    panel::option(row, "Zoom out", choose, ZoomOut);
    panel::option(row, "Zoom in", choose, ZoomIn);
    panel::option(row, "Fit routes", choose, FitRoutes);
    row = panel::optionRow(parent, "Map orientation");
    panel::option(row, "Portrait", choose, Portrait, portrait);
    panel::option(row, "Landscape", choose, Landscape, !portrait);
    row = panel::optionRow(parent, "Routes");
    panel::option(row, "All", choose, AllRoutes, !mask);
    for (unsigned i = 0; i < routes.size(); ++i)
        panel::option(row, routes[i].name, choose, Route + i, mask & (1u << i));
}
void init() {
    cx=mapW*.5f; cy=mapH*.5f;
    zoom=transport::defaultZoom;
    MapSettings s{};
    if(transport::loadView("lakes_view",s) && s.zoom>=1 && s.zoom<=24 && std::isfinite(s.x) && std::isfinite(s.y)){
        zoom=s.zoom;cx=s.x;cy=s.y;mask=s.mask&((1u<<routes.size())-1);portrait=s.portrait!=0;dark=s.dark!=0;
    }
    setenv("TZ", "GMT0BST,M3.5.0/1,M10.5.0/2", 1);
    tzset();
    loadFrame();
    layout();
    dirty = true;
}
void receive(Snapshot data, uint32_t now) {
    if (haveLive && data.time < latest.time)
        return;
    if (haveLive && !liveFailed && !manualReplay) {
        const int64_t wall = int64_t(time(nullptr)) * 1000;
        for (const auto &v : data.vehicles)
            if (visible(v.route) && newRailReport(latest, data, v, wall))
                panel::trainHorn(v.direction > 0, v.lastStop == 1);
    }
    locateBuses(data);
    haveLive = true;
    latest = std::move(data);
    updated = now;
    liveFailed = false;
    dirty = true;
    if (!manualReplay && (!selection.empty() || stopSelection >= 0)) {
        int previous = page;
        fillDetails(now);
        page = std::min(previous, std::max(0, (int(details.size()) - 1) / 5));
    }
}
void failed() {
    liveFailed = true;
    dirty = true;
}
bool needsRender(uint32_t now) {
    if (manualReplay && selection.empty() && stopSelection < 0 && now - replayAt >= 15000) {
        replayFrame = (replayFrame + 1) % std::size(recordings);
        loadFrame();
        replayAt = now;
        dirty = true;
    }
    return dirty || now - lastDraw >= 15000;
}
void requestRedraw() { dirty = true; }
std::string status() {
    return std::string(replaying() ? "replay" : "live") + " mask=" + std::to_string(mask) +
           " zoom=" + std::to_string(zoom) +
           " detail=" + (stopSelection >= 0 ? std::string(groups[stopSelection].name) : selection);
}
void render(uint16_t *target, uint32_t now) {
    pixels = target;
    layout();
    ink = color(dark ? 0xe7eee9 : 0x17392f);
    paper = color(dark ? 0x1c3029 : 0xf7f8ed);
    edge = color(dark ? 0x618477 : 0xb9c6b6);
    muted = color(dark ? 0xb9d0c4 : 0x456558);
    hits.clear();
    baseMap();
    network();
    geography();
    vehicles(now);
    card();
    toolbar(now);
    lastDraw = now;
    dirty = false;
}
int visibleCount() { return count; }
void gesture(int px, int py, int pdx, int pdy, uint32_t now) {
    int x = portrait ? py : px, y = portrait ? panelWidth - 1 - px : py;
    int dx = portrait ? pdy : pdx, dy = portrait ? -pdx : pdy;
    if (abs(dx) + abs(dy) > 14) {
        if (y - dy >= top && y >= top && y < bottom && selection.empty() && stopSelection < 0) {
            cx = std::clamp(cx - dx / scale, 0.f, float(mapW));
            cy = std::clamp(cy - dy / scale, 0.f, float(mapH));
            dirty = true;
            saveView();
        }
        return;
    }
    for (auto it = hits.rbegin(); it != hits.rend(); it++) {
        auto b = it->box;
        if (x < b.x || x >= b.x + b.w || y < b.y || y >= b.y + b.h)
            continue;
        int i = it->index;
        Action a = it->action;
        switch (a) {
        case Marker:
            if (unsigned(i) < active().vehicles.size()) {
                selection = active().vehicles[i].id;
                stopSelection = -1;
                fillDetails(now);
            }
            break;
        case BusStop:
            stopSelection = i;
            selection.clear();
            fillDetails(now);
            break;
        case Back:
            page = std::max(0, page - 1);
            break;
        case More:
            page = std::min(page + 1, std::max(0, (int(details.size()) - 1) / 5));
            break;
        case Close:
            if (i != -2) {
                selection.clear();
                stopSelection = -1;
                replayAt = now;
            }
            break;
        }

        dirty = true;
        return;
    }
}
} // namespace lakes
