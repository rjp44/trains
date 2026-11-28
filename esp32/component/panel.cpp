#include "panel.h"
#include "input.h"
#include <string>
#include <cstdlib>
#include <cstdio>
#include <algorithm>
#include <array>
#include <cstring>

#ifdef TRANSPORT_CORE
#include "rows.h"
#include "rail-spacing.h"
#include "watch-picker.h"
#include "core.h"
#include "esp_rom_crc.h"
#include "view-settings.h"
#include "toolbar.h"
#endif

namespace hemel {
namespace {
template <typename T> struct List {
    const T *data;
    size_t size;
    const T *begin() const { return data; }
    const T *end() const { return data + size; }
};
template <typename T, size_t N> constexpr List<T> list(const T (&items)[N]) { return {items, N}; }

enum Ink {
    Board,
    Text,
    Muted,
    Rail,
    Platform,
    DC,
    Abbey,
    Bay,
    StationBand,
    HemelBand,
    JunctionBand,
    Edge,
    HemelEdge,
    On,
    Off,
    Unknown,
    TrainFill,
    TrainText,
    Other,
    Stale
};
struct Segment {
    int16_t x1, y1, x2, y2;
    uint8_t ink;
    uint16_t width;
    uint8_t station = 0; // One-based index in the package watch directory.
};
struct Label {
    int16_t x, y, width;
    int8_t font, ink, background;
    const char *text;
    uint8_t preset, station = 0;
};
struct Marker {
    uint16_t id;
    int16_t x, y, signalY, radius;
    int16_t signalOffset = 0;
};
struct CardSpace {
    int centre, left, top, bottom;
};
struct Scene {
    List<Segment> lines;
    List<Label> labels;
    List<Marker> markers;
    CardSpace fast, slow;
    int badgeWidth, badgeHeight;
};
struct Change {
    uint16_t id;
    uint8_t aspect, kind;
    const char *head;
    uint16_t detail;
};
struct Frame {
    uint32_t ms;
    uint16_t end;
    uint16_t cards[4];
};
struct Recording {
    List<Change> changes;
    List<Frame> frames;
    uint32_t duration;
};
struct Card {
    const char *head, *context, *route, *running;
    uint32_t identity;
};
struct Detail {
    const char *service, *route, *running, *label = "";
};
struct OperatorTag {
    const char *code, *name;
    uint32_t background, foreground;
};
struct MarkerInfo {
    const char *id, *signal, *bit, *track;
};
struct Reading {
    unsigned aspect = 0, kind = 0;
    const char *head = "";
    Detail detail{"", "", ""};
};
#ifdef TRANSPORT_CORE
#include "hemel-runtime.inc"
#else
#include "panel_assets.h"
#endif

const Scene *scene = &sectorScene;
const Recording *recording = &sectorRecording;
const uint32_t *palette = darkPalette;
lv_obj_t *screen = nullptr;
#ifdef TRANSPORT_CORE
std::vector<Reading> current;
std::vector<std::string> liveText;
#else
std::array<Reading, markerCount> current{};
std::array<std::string, markerCount> liveText;
#endif
bool liveMode = false, offline = false, frameDirty = false;
unsigned feedStatus = 0;
uint32_t observedAt = 0;
std::array<std::string, 4> liveCardText;
Card liveCards[4]{};
const Card *choices[4]{};
lv_indev_t *touchDevice = nullptr;
lv_point_t pointerPoint{}, startPoint{};
bool pressed = false, dragged = false;
struct Selection {
    int index = -1, x = 0, y = 0;
    bool signal = false, present = false;
    std::string head, service, route, running;
};
Selection selected;
#ifdef TRANSPORT_CORE
Selection tracked;
#endif
size_t nextFrame = 0, nextChange = 0;
uint32_t cursor = 0;
struct Rotation {
    uint32_t first, second, since;
    const Card *shown;
};
Rotation rotation[2]{};

lv_color_t colour(int ink) { return lv_color_hex(palette[ink]); }
void invalidate() {
    if (screen)
        lv_obj_invalidate(screen);
}
const lv_font_t *font(int pixels) {
    if (pixels >= 16)
        return &lv_font_montserrat_16;
    if (pixels >= 14)
        return &lv_font_montserrat_14;
    if (pixels >= 12)
        return &lv_font_montserrat_12;
    if (pixels >= 10)
        return &lv_font_montserrat_10;
    return &lv_font_montserrat_8;
}
int textWidth(const char *s, const lv_font_t *f) { return lv_text_get_width(s, std::strlen(s), f, 0); }
void box(lv_layer_t *layer, int x, int y, int w, int h, int fill, int edge = -1, int radius = 0, int rgb = -1) {
    if (w <= 0 || h <= 0)
        return;
    lv_area_t bounds{x, y, x + w - 1, y + h - 1};
    lv_draw_rect_dsc_t d;
    lv_draw_rect_dsc_init(&d);
    d.bg_color = rgb < 0 ? colour(fill) : lv_color_hex(rgb);
    d.radius = radius;
    if (edge >= 0) {
        d.border_color = colour(edge);
        d.border_width = 1;
    }
    lv_draw_rect(layer, &d, &bounds);
}
void text(lv_layer_t *layer, int x, int cy, int w, const char *s, int size, int ink, bool centred = true, int rgb = -1) {
    const lv_font_t *f = font(size);
    while (size > 8 && textWidth(s, f) > w) {
        size -= 2;
        f = font(size);
    }
    int y = cy - f->line_height / 2;
    lv_area_t a{x, y, x + w - 1, y + f->line_height - 1};
    lv_draw_label_dsc_t d;
    lv_draw_label_dsc_init(&d);
    d.text = s;
    d.text_local = true;
    d.font = f;
    d.color = rgb < 0 ? colour(ink) : lv_color_hex(rgb);
    const int excess = textWidth(s, f) - w;
    if (excess > 0 && std::strlen(s) > 1) {
        const int gaps = static_cast<int>(std::strlen(s)) - 1;
        d.letter_space = -std::min(2, (excess + gaps - 1) / gaps);
    }
    d.align = centred ? LV_TEXT_ALIGN_CENTER : LV_TEXT_ALIGN_LEFT;
    d.flag = LV_TEXT_FLAG_EXPAND;
    lv_draw_label(layer, &d, &a);
}
void signal(lv_layer_t *layer, const Marker &m, uint8_t aspect) {
    const int r = m.radius, ink = aspect == 1 ? On : aspect == 2 ? Off : Unknown;
    box(layer, m.x + m.signalOffset - r, m.signalY - r, 2 * r + 1, 2 * r + 1, aspect == 1 ? ink : Board, ink,
        LV_RADIUS_CIRCLE);
}
void badge(lv_layer_t *layer, const Marker &m, int width) {
    const auto &train = current[m.id];
    const int h = scene->badgeHeight;
    int x = m.x - width / 2;
#ifdef TRANSPORT_CORE
    if (tracked.present && tracked.index == m.id)
        box(layer, x - 2, m.y - h / 2 - 2, width + 4, h + 4, Board, -1, 5,
            palette == darkPalette ? 0x66e4ff : 0x263c91);
#endif
    box(layer, x, m.y - h / 2, width, h,
        offline           ? Stale
        : train.kind == 1 ? TrainFill
        : train.kind == 2 ? Other
                          : Stale,
        -1, 3);
    const int size = std::min(16, h - 2);
#ifdef TRANSPORT_CORE
    const char *label = train.detail.label;
    const size_t length = strlen(label);
    if (labelMode == 1 && *train.detail.service && (length == 3 || length == 5)) {
        const char crs[] = {label[0], label[1], label[2], 0};
        if (length == 5 && width >= 30) {
            const auto tag = std::find_if(operatorTags.begin(), operatorTags.end(),
                [&](const OperatorTag &op) { return !strcmp(op.code, label + 3); });
            const bool known = tag != operatorTags.end();
            const int chip = (width * 36 + 50) / 100;
            box(layer, x + 1, m.y - h / 2 + 1, chip, h - 2, Board, -1, 2, known ? tag->background : 0x374247);
            text(layer, x + 1, m.y, chip, known ? tag->name : label + 3, std::min(12, h - 4), Text,
                 true, known ? tag->foreground : 0xf4f5f6);
            x += chip + 1;
            width -= chip + 1;
        }
        text(layer, x, m.y, width, crs, size, TrainText);
        return;
    }
#endif
    text(layer, x, m.y, width, train.head, size, TrainText);
}
struct Rect {
    int x, y, w, h;
    bool contains(int px, int py) const { return px >= x && px < x + w && py >= y && py < y + h; }
};
struct CardLayout {
    Rect bounds;
    int bodySize, headSize, headWidth;
};
CardLayout cardLayout(int line, const Card &c) {
    const auto &space = line ? scene->slow : scene->fast;
    const int h = std::min(line ? 72 : 66, space.bottom - space.top);
    if (h < 16)
        return {};
    const int body = h >= 70 ? 16 : h >= 51 ? 14 : h >= 41 ? 12 : h >= 34 ? 10 : 8;
    const int head = h >= 57 ? 16 : body;
    const int headW = textWidth(c.head, font(head)) + 10;
    const int preferred = std::max({headW + 20 + textWidth(c.context, font(body)),
                                    16 + textWidth(c.route, font(body)),
                                    16 + textWidth(c.running, font(body))});
    const int w = std::min(preferred, panelWidth - space.left - 4);
    const int x = std::clamp(space.centre - w / 2, space.left, panelWidth - w - 4);
    return {{x, line ? space.top : space.bottom - h, w, h}, body, head, headW};
}
void card(lv_layer_t *layer, int line, const Card &c) {
    const auto layout = cardLayout(line, c);
    const auto [x, y, w, h] = layout.bounds;
    if (!h)
        return;
    const int rowH = h / 3;
    box(layer, x, y, w, h, HemelBand, HemelEdge, 4);
    box(layer, x + 6, y + 2, layout.headWidth, rowH - 2, TrainFill, -1, 2);
    text(layer, x + 6, y + rowH / 2 + 1, layout.headWidth, c.head, layout.headSize, TrainText);
    text(layer, x + layout.headWidth + 12, y + rowH / 2 + 1, w - layout.headWidth - 18,
         c.context, layout.bodySize, Muted, false);
    text(layer, x + 8, y + rowH + rowH / 2, w - 16, c.route, layout.bodySize, Text, false);
    text(layer, x + 8, y + 2 * rowH + rowH / 2, w - 16, c.running, layout.bodySize, Text, false);
}
#ifdef TRANSPORT_CORE
// Stale readings share a wire kind, so check their text as well as fresh status.
bool passengerMapDescription(const Reading &r) {
    if (r.kind != 3) return r.kind == 1;
    std::string_view h(r.head);
    auto digit = [](char c) { return c >= '0' && c <= '9'; };
    auto letter = [](char c) { return c >= 'A' && c <= 'Z'; };
    return h.size() == 4 && digit(h[2]) && digit(h[3]) &&
           ((digit(h[0]) && letter(h[1])) || (letter(h[0]) && digit(h[1])));
}
#endif
template <class Visitor> void visitBadges(Visitor visit) {
    const Marker *prev = nullptr;
    int prevWidth = 0;
    // Marker coordinates are ordered by lane, then column. Size a badge to
    // the closest occupied neighbour on either side, preserving its centre.
#ifdef TRANSPORT_CORE
    const bool overview = regionalLayout() && !directionalLayout();
#endif
    for (const Marker &m : scene->markers) {
#ifdef TRANSPORT_CORE
        if (overview ? m.radius != 0 : !passengerMapDescription(current[m.id])) continue;
#endif
        if (!current[m.id].kind)
            continue;
        int w = scene->badgeWidth;
        if (prev) {
            if (prev->y == m.y && prev->x < m.x)
                w = std::clamp(m.x - prev->x - 2, 1, w);
            visit(*prev, std::min(prevWidth, w));
        }
        prev = &m;
        prevWidth = w;
    }
    if (prev)
        visit(*prev, prevWidth);
}

Rect button(int row) { return {3, 2 + row * 34, std::min(88, panelWidth / 9), 32}; }
Rect popup() {
    const int w = std::min(350, panelWidth - 8), h = 104;
#ifdef TRANSPORT_CORE
    const int minY = transport::toolbarHeight + 2;
#else
    const int minY = 4;
#endif
    return {std::clamp(selected.x - w / 2, 4, panelWidth - w - 4),
            std::clamp(selected.y > h + 20 ? selected.y - h - 14 : selected.y + 14, minY, panelHeight - h - 4),
            w, h};
}
void trackSelection(Selection &selected, bool followService = false) {
    if (selected.index < 0 || selected.signal)
        return;
    const auto compatible = [&](int i) {
        const auto &r = current[i];
        if (!r.kind || selected.head != r.head)
            return false;
        if (!selected.service.empty())
            return selected.service == r.detail.service || (i == selected.index && !*r.detail.service);
        return std::strncmp(markerInfo[selected.index].id, markerInfo[i].id, 2) == 0;
    };
    int index = selected.index;
    if (!compatible(index)) {
        index = -1;
        for (int i = 0; i < markerCount; ++i)
            if (compatible(i)) {
                if (index >= 0 && followService && !selected.service.empty() && selected.service == current[index].detail.service && selected.service == current[i].detail.service) continue;
                if (index >= 0) {
                    index = -1;
                    break;
                }
                index = i;
            }
    }
    selected.present = index >= 0;
    if (!selected.present)
        return;
    selected.index = index;
    const auto &info = current[index].detail;
    if (*info.service || selected.service.empty()) {
        selected.service = info.service;
        selected.route = info.route;
        selected.running = info.running;
    }
}
#ifdef TRANSPORT_CORE
void chooseTrain(int id, int x, int y);
void watchLocation(const char *name);
int promptStation=-1;
#include "berth-register.inc"
#include "corridor-scroll.inc"
#include "rail-watch.inc"
#endif
void drawControls(lv_layer_t *layer) {
#ifdef TRANSPORT_CORE
    drawCorridorLegend(layer);
    box(layer, 0, 0, panelWidth, transport::toolbarHeight, Board);
    const char *viewName = hemel::viewName(currentView());
    text(layer, 60, transport::toolbarHeight / 2, panelWidth - 120, viewName, 16, Text);
#else
    const char *viewName = scene == &hemelScene ? "Hemel" : scene == &watfordScene ? "Watford" : "15 miles";
    const char *labels[] = {viewName, palette == darkPalette ? "Light" : "Dark"};
    for (int i = 0; i < 2; ++i) {
        auto r = button(i);
        box(layer, r.x, r.y, r.w, r.h, Board, Edge, 4);
        text(layer, r.x, r.y + r.h / 2, r.w, labels[i], 12, Text);
    }
#endif
    {
        const char *statuses[] = {"Waiting", "Live", "Partial", "Stale", "Replay"};
        text(layer, 2, panelHeight - 22, button(0).w,
             !liveMode ? "Replay"
             : offline ? "Link lost"
                       : statuses[feedStatus],
             12, Muted);
        if (liveMode && observedAt) {
            char time[10];
            std::snprintf(time, sizeof(time), "%02u:%02uZ", unsigned(observedAt / 3600 % 24),
                          unsigned(observedAt / 60 % 60));
            text(layer, 2, panelHeight - 8, button(0).w, time, 10, Muted);
        }
    }
#ifdef TRANSPORT_CORE
    if (directionalLayout()) drawScrollBar(layer);
    drawWatch(layer);
    drawRegister(layer);
#endif
    if (selected.index < 0)
        return;
    const auto r = popup();
    const auto &m = markerInfo[selected.index];
    const int x = r.x + 9, w = r.w - 18;
    box(layer, r.x, r.y, r.w, r.h, Board, HemelEdge, 5);
    text(layer, r.x + r.w - 34, r.y + 16, 28, "X", 14, Text);
    std::string where = m.track;
#ifdef TRANSPORT_CORE
    if (!selected.signal && selected.present && passengerMapDescription(current[selected.index]))
        text(layer,r.x+r.w-112,r.y+16,67,"Follow",14,Text);
    if (selected.signal || !regionalLayout())
#endif
        where += std::string(" | ") + m.id;
    if (selected.signal) {
        const unsigned aspect = offline ? 0 : current[selected.index].aspect;
        text(layer, x, r.y + 17, w - 35, m.signal, 16, Text, false);
        text(layer, x, r.y + 44, w,
             aspect == 1   ? "On - most restrictive"
             : aspect == 2 ? "Off - less restrictive"
                           : "Indication unknown",
             14, Text, false);
        text(layer, x, r.y + 70, w, where.c_str(), 12, Muted, false);
        text(layer, x, r.y + 90, w, m.bit, 12, Muted, false);
    } else {
        text(layer, x, r.y + 17, w - 35, selected.head.c_str(), 16, Text, false);
        const char *fallback =
            current[selected.index].kind == 2 ? "Signalling description" : "Service details unavailable";
        text(layer, x, r.y + 41, w, selected.route.empty() ? fallback : selected.route.c_str(), 14, Text,
             false);
        text(layer, x, r.y + 65, w, selected.running.c_str(), 12, Text, false);
        const char *condition = offline || current[selected.index].kind == 3 ? "Last known"
                                : !selected.present                          ? "Last seen"
                                : std::strncmp(m.id, "AB", 2) == 0           ? "Station report"
                                                                             : "Current";
        const std::string location = std::string(condition) + " | " + where;
        text(layer, x, r.y + 87, w, location.c_str(), 12, Muted, false);
    }
}
void chooseTrain(int id, int x, int y) {
    selected = {};
    selected.index = id;
    selected.x = x;
    selected.y = y;
    selected.head = current[id].head;
    trackSelection(selected);
    invalidate();
}
void tap(int x, int y) {
    if (selected.index >= 0) {
        const auto r = popup();
        if (r.contains(x, y)) {
#ifdef TRANSPORT_CORE
            if (x>=r.x+r.w-120 && x<r.x+r.w-40 && y<r.y+36 && !selected.signal && selected.present && passengerMapDescription(current[selected.index])) {
                watchChanged=true; tracked=selected; registerIndex=-1; dismiss(); updateWatch(lv_tick_get()); return;
            }
#endif
            if (x >= r.x + r.w - 40 && y < r.y + 36)
                dismiss();
            return;
        }
        dismiss();
#ifdef TRANSPORT_CORE
        if (registerIndex>=0) return;
#endif
    }
#ifdef TRANSPORT_CORE
    if (registerTap(x,y) || watchTap(x,y) || scrollBarTap(x,y)) return;
    if (x < activeCorridor().legendWidth) return;
#endif
#ifndef TRANSPORT_CORE
    if (button(0).contains(x, y)) {
        view(scene == &sectorScene ? View::Hemel : scene == &hemelScene ? View::Watford : View::Sector);
        return;
    }
    if (button(1).contains(x, y)) {
        toggleLight();
        return;
    }
#endif
    for (int line = 0; line < 2; ++line) {
#ifdef TRANSPORT_CORE
        if (!defaultCards()) break;
#endif
        auto *c = rotation[line].shown;
        if (offline || !c || !cardLayout(line, *c).bounds.contains(x, y))
            continue;
        // A headcode may appear in multiple berths. Only open an unambiguous
        // match with the track printed on this card.
        int match = -1;
        for (int i = 0; i < markerCount; ++i) {
            auto track = std::string_view(markerInfo[i].track);
            track = track.substr(0, track.find(" | "));
            if (!current[i].kind || std::strcmp(current[i].head, c->head) ||
                std::string_view(c->context).substr(0, track.size()) != track)
                continue;
            if (match >= 0)
                return;
            match = i;
        }
        if (match >= 0)
            chooseTrain(match, x, y);
        return;
    }
    int best = -1;
    visitBadges([&](const Marker &m, int w) {
        if (Rect{m.x - w / 2, m.y - scene->badgeHeight / 2, w, scene->badgeHeight}.contains(x, y))
            best = m.id;
    });
    if (best >= 0) {
        chooseTrain(best, x, y);
        return;
    }
    const Marker *nearest = nullptr;
    int distance = 500;
    for (const auto &m : scene->markers)
        if (m.radius) {
            const int dx = m.x + m.signalOffset - x, dy = m.signalY - y, d = dx * dx + dy * dy,
                      radius = std::max(9, int(m.radius) + 3);
            if (d <= radius * radius && d < distance) {
                nearest = &m;
                distance = d;
            }
        }
    if (nearest) {
        selected.index = nearest->id;
        selected.x = x;
        selected.y = y;
        selected.signal = true;
        invalidate();
        return;
    }
    for (const auto &label : scene->labels)
        if (std::abs(x - label.x) <= label.width / 2 && std::abs(y - label.y) <= 12) {
#ifdef TRANSPORT_CORE
            if (openRegister(label.text)) return;
            if (label.preset && !watchStations.empty()) {
                promptStation=label.preset>=3 ? label.preset-3 : watchNumber(label.preset==1?"HML":"WFJ");
                invalidate(); return;
            }
#endif
            if (!label.preset) continue;
            view(label.preset == 1 ? View::Hemel : View::Watford);
            return;
        }
#ifdef TRANSPORT_CORE
    if(continuousZoom()) for(const auto &band:scene->lines)
        if(band.station && band.x1==band.x2 && std::abs(x-band.x1)<=band.width/2 &&
            y>=std::min(band.y1,band.y2) && y<=std::max(band.y1,band.y2)){
            if(!openRegister(watchStations[band.station-1].name)) promptStation=band.station-1;
            invalidate();return;
        }
#endif
}
void touch(lv_event_t *e) {
    lv_point_t p;
    lv_indev_get_point(lv_event_get_indev(e), &p);
    if (lv_event_get_code(e) == LV_EVENT_PRESSED) {
        startPoint = p;
        dragged = false;
    } else {
        if (std::abs(p.x - startPoint.x) > 12 || std::abs(p.y - startPoint.y) > 12)
            dragged = true;
        if (lv_event_get_code(e) == LV_EVENT_CLICKED && !dragged)
            tap(p.x, p.y);
    }
}
void draw(lv_event_t *event) {
    auto *layer = lv_event_get_layer(event);
#ifdef TRANSPORT_CORE
    const int activeStation = tracked.index < 0 ? watching + 1 : 0;
#endif
    for (const auto &s : scene->lines) {
        int ink = s.ink;
#ifdef TRANSPORT_CORE
        if (s.station) {
            if (s.station == activeStation) ink = HemelBand;
            else if (ink == Board) continue;
        }
#endif
        lv_draw_line_dsc_t d;
        lv_draw_line_dsc_init(&d);
        d.p1.x = s.x1;
        d.p1.y = s.y1;
        d.p2.x = s.x2;
        d.p2.y = s.y2;
        d.color = colour(ink);
        d.width = s.width;
        lv_draw_line(layer, &d);
    }
    for (const auto &l : scene->labels) {
        const int x = l.x - l.width / 2, h = font(l.font)->line_height + 2;
        int background = l.background;
#ifdef TRANSPORT_CORE
        if (l.station && l.station == activeStation) background = HemelBand;
#endif
        if (background >= 0)
            box(layer, x, l.y - h / 2, l.width, h, background, background == HemelBand ? HemelEdge : Edge,
                3);
        text(layer, x, l.y, l.width, l.text, l.font, l.ink);
    }
    for (const auto &m : scene->markers) {
        if (m.radius)
            signal(layer, m, offline ? 0 : current[m.id].aspect);
    }
    visitBadges([&](const Marker &m, int w) { badge(layer, m, w); });
    for (int i = 0; i < 2; ++i)
        if (rotation[i].shown && !offline
#ifdef TRANSPORT_CORE
            && defaultCards()
#endif
        )
            card(layer, i, *rotation[i].shown);
    drawControls(layer);
}
void reset() {
    std::fill(current.begin(), current.end(), Reading{});
    nextFrame = nextChange = cursor = 0;
    std::fill_n(choices, 4, nullptr);
    selected = {};
#ifdef TRANSPORT_CORE
    watchChanged=true; restoreSector(); tracked={}; lastFocus=-1; watchMarker=-1; promptStation=-1;
#endif
    rotation[0] = {};
    rotation[1] = {};
    invalidate();
}
} // namespace
#ifdef TRANSPORT_CORE
bool mountPackage(){
    if(!loadHemel() || !loadRegister()) return false;
    current.resize(markerCount);liveText.resize(markerCount);return true;
}
#endif
int width() { return panelWidth; }
int height() { return panelHeight; }
bool attach(lv_display_t *display) {
    if (!display || screen || lv_display_get_horizontal_resolution(display) != width() ||
        lv_display_get_vertical_resolution(display) != height())
        return false;
    screen = lv_display_get_screen_active(display);
    lv_obj_remove_style_all(screen);
    lv_obj_set_style_bg_color(screen, colour(Board), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    lv_obj_add_event_cb(screen, draw, LV_EVENT_DRAW_MAIN, nullptr);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(screen, LV_OBJ_FLAG_CLICKABLE);
    for (auto code : {LV_EVENT_PRESSED, LV_EVENT_PRESSING, LV_EVENT_CLICKED})
        lv_obj_add_event_cb(screen, touch, code, nullptr);
    touchDevice = lv_indev_create();
    lv_indev_set_type(touchDevice, LV_INDEV_TYPE_POINTER);
    lv_indev_set_display(touchDevice, display);
    lv_indev_set_mode(touchDevice, LV_INDEV_MODE_EVENT);
    lv_indev_set_read_cb(touchDevice, [](lv_indev_t *, lv_indev_data_t *d) {
        d->point = pointerPoint;
        d->state = pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
    });
    return true;
}
void pointer(int x, int y, bool down) {
    if (!touchDevice)
        return;
    if (x < 0 || y < 0 || x >= width() || y >= height()) {
        if (!pressed)
            return;
        dragged = true;
        x = std::clamp(x, 0, width() - 1);
        y = std::clamp(y, 0, height() - 1);
    }
    pointerPoint = {x, y};
    pressed = down;
    lv_indev_read(touchDevice);
}
bool dismiss() {
    if (selected.index < 0)
        return false;
    selected = {};
    invalidate();
    return true;
}
void toggleLight() { light(palette == darkPalette); }
#ifdef TRANSPORT_CORE
View currentView() {
    return scene == &hemelScene ? View::Hemel : scene == &watfordScene ? View::Watford : View::Sector;
}
bool isLight() { return palette == lightPalette; }
void pinchView(bool closer, int x) {
    if (directionalLayout()) {
        auto &v = activeCorridor();
        if ((closer && currentView()!=View::Sector) || (!closer && currentView()==View::Sector)) return;
        const auto &stop = v.stations[stationAt(v.pan+std::max(0,x-v.legendWidth))];
        View target = View::Sector;
        if (closer) {
            const auto &second=viewTables[2].stations;
            target = std::any_of(second.begin(),second.end(),[&](const auto &s){return !strcmp(s.id,stop.id);})
                ? View::Watford : View::Hemel;
        }
        view(target);
        auto &next=activeCorridor();
        for (const auto &s:next.stations) if(!strcmp(s.id,stop.id)) { panTo(stationCentre(next,s)-next.viewportWidth()/2); break; }
        return;
    }
    if (!closer) {
        if (currentView() != View::Sector) view(View::Sector);
        return;
    }
    if (currentView() != View::Sector) return;
    int nearest = panelWidth + 1;
    View target = View::Hemel;
    for (const auto &label : sectorScene.labels) {
        int gap = std::abs(x - label.x);
        if ((label.preset == 1 || label.preset == 2) && gap < nearest) {
            nearest = gap;
            target = label.preset == 1 ? View::Hemel : View::Watford;
        }
    }
    view(target);
}
bool continuousZoom() { return activeCorridor().camera; }
bool directionalLayout() { return regionalLayout() && !activeCorridor().stations.empty(); }
int zoomPercent() { return std::lround(activeCorridor().axis.zoom*100); }
static bool cameraBlocked() {return registerIndex>=0 || promptStation>=0 || selected.index>=0;}
static void cameraZoom(float request, int fromX, int toX) {
    auto &v=activeCorridor();
    if(!v.camera || !v.axis.ready() || !std::isfinite(request)) return;
    float anchor=v.axis.unproject(v.pan+std::max(0,fromX-v.legendWidth));
    v.request=request<=v.axis.minZoom?0:std::min(3.f,request);
    v.axis.setZoom(v.request);
    arrangeHeaders(v);
    panTo(std::lround(v.axis.project(anchor))-std::max(0,toX-v.legendWidth));
}
void pinch(float ratio, int fromX, int toX) {
    if(!cameraBlocked()) cameraZoom(activeCorridor().axis.zoom*ratio,fromX,toX);
}
static std::string zoomKey() {
    const char *id=transport::activeApp();
    return "rz"+std::to_string(esp_rom_crc32_le(0,reinterpret_cast<const uint8_t*>(id),strlen(id)));
}
void finishPinch() {
    if(!continuousZoom()) return;
    std::array<float,3> zoom;
    for(int i=0;i<3;++i) zoom[i]=viewTables[i].request;
    transport::saveView(zoomKey().c_str(),zoom);
}
void stepZoom(int direction) {
    auto &v=activeCorridor();int middle=v.legendWidth+v.viewportWidth()/2;
    cameraZoom(direction?v.axis.zoom*(direction>0?1.25f:0.8f):v.defaultZoom,middle,middle);
    finishPinch();
}
bool dragCorridor(int dx, int startY) {
    if ((!continuousZoom() && !directionalLayout()) || cameraBlocked() || startY<transport::toolbarHeight) return false;
    const auto &v=activeCorridor();
    if (directionalLayout() && startY>=scrollY) panTo(v.pan + int(std::lround(dx * double(v.drawnWidth()-v.viewportWidth()) / scrollWidth)));
    else panTo(v.pan-dx);
    return true;
}
bool regionalLayout() { return transport::field(transport::tables,"viewNames") != nullptr; }
const char *viewName(View value) {
    const char *fallback[] = {"15-mile sector","Hemel Hempstead","Watford Junction"};
    unsigned i = static_cast<unsigned>(value);
    auto label = cJSON_GetStringValue(cJSON_GetArrayItem(transport::field(transport::tables,"viewNames"),i));
    return label ? label : fallback[i];
}
static std::string viewKey() {
    if (!regionalLayout()) return "hemel_view";
    const char *id = transport::activeApp();
    return "rv" + std::to_string(esp_rom_crc32_le(0,reinterpret_cast<const uint8_t*>(id),strlen(id)));
}
struct SchematicSettings {uint32_t view,light;};
static bool restoringView;
static void saveSchematic(){
    if(!restoringView)transport::saveView(viewKey().c_str(),SchematicSettings{scene==&hemelScene?1u:scene==&watfordScene?2u:0u,palette==lightPalette});
}
bool friendlyLabels() { return labelMode == 1; }
void setFriendlyLabels(bool enabled) {
    labelMode = enabled ? 1 : 0;
    transport::saveView("rail_labels", labelMode);
    invalidate();
}
void setLiveAreas(const char *areas) {freshAreas=" "+std::string(areas)+" ";}
const char *watchedStation() {
    if(tracked.index>=0) return "";
    if(watchStations.empty()) return regionalLayout() ? "@legacy" : "HML";
    return watching<0 ? "" : watchStations[watching].id;
}
void watchOptions(lv_obj_t *parent) {
    if(watchStations.empty()) return;
    std::string options="Off";
    for(const auto &s:watchStations) options+="\n"+std::string(s.name);
    transport::watchPicker(parent,options,watching+1,[](lv_event_t *e){
        selectWatch(int(lv_dropdown_get_selected((lv_obj_t*)lv_event_get_target(e)))-1);
    });
}
void restoreView(View fallback){
    const char *id=cJSON_GetStringValue(transport::field(transport::tables,"watchDefault"));
    char saved[16]={};
    watching=watchNumber(transport::loadView(watchKey().c_str(),saved) ? saved : id);
    transport::loadView("rail_labels", labelMode);
    std::array<float,3> zoom;
    if (transport::loadView(zoomKey().c_str(),zoom))
        for(int i=0;i<3;++i) if(viewTables[i].camera && std::isfinite(zoom[i]) && zoom[i]>=0 && zoom[i]<=3)
            viewTables[i].request=zoom[i];
    SchematicSettings s{static_cast<unsigned>(fallback),0};
    transport::loadView(viewKey().c_str(),s);restoringView=true;
    view(s.view<=2?static_cast<View>(s.view):fallback);light(s.light==1);restoringView=false;
}
#endif
void view(View value) {
#ifdef TRANSPORT_CORE
    registerIndex=-1;
#endif
    dismiss();
    scene = value == View::Hemel ? &hemelScene : value == View::Watford ? &watfordScene : &sectorScene;
#ifdef TRANSPORT_CORE
    if (continuousZoom()) updateCamera(true);
    else if (directionalLayout()) panTo(activeCorridor().pan);
    saveSchematic();
#endif
    invalidate();
}
void light(bool enabled) {
    palette = enabled ? lightPalette : darkPalette;
#ifdef TRANSPORT_CORE
    saveSchematic();
#endif
    if (screen)
        lv_obj_set_style_bg_color(screen, colour(Board), 0);
    invalidate();
}
void replay(Sample value) {
    liveMode = offline = false;
    input::forgetSequence();
    recording = value == Sample::Hemel     ? &hemelRecording
                : value == Sample::Watford ? &watfordRecording
                                           : &sectorRecording;
    reset();
}
uint32_t duration() { return recording->duration; }
void seek(uint32_t position, uint32_t wall) {
    position = std::min(position, duration());
    if (position < cursor)
        reset();
    cursor = position;
    bool changed = false;
    while (nextFrame < recording->frames.size && recording->frames.data[nextFrame].ms <= position) {
        const auto &frame = recording->frames.data[nextFrame++];
        while (nextChange < frame.end) {
            const auto &delta = recording->changes.data[nextChange++];
            current[delta.id] = {delta.aspect, delta.kind, delta.head, details[delta.detail]};
        }
        for (int i = 0; i < 4; i++)
            choices[i] = frame.cards[i] ? &cards[frame.cards[i]] : nullptr;
        changed = true;
    }
    if (changed) {
#ifdef TRANSPORT_CORE
        watchChanged=true;
#endif
        trackSelection(selected);
        invalidate();
    }
    refreshCards(wall);
}
void refreshCards(uint32_t wall) {
#ifdef TRANSPORT_CORE
    updateCamera();
    updateWatch(wall);
#endif
    for (int i = 0; i < 2; ++i) {
        auto &r = rotation[i];
        const auto *first = choices[2 * i], *second = choices[2 * i + 1];
        uint32_t a = first ? first->identity : 0, b = second ? second->identity : 0;
        if (a != r.first || b != r.second) {
            r.first = a;
            r.second = b;
            r.since = wall;
        }
        auto next = second && (wall - r.since) / 5000 % 2 ? second : first;
        if (r.shown != next) {
            r.shown = next;
            invalidate();
        }
    }
}
bool isLive() { return liveMode; }
void beginLive() {
    reset();
    liveMode = true;
    offline = false;
    feedStatus = 0;
    observedAt = 0;
    input::forgetSequence();
}
namespace input {
uint32_t fingerprint() { return layoutFingerprint; }
unsigned markers() { return markerCount; }
void startFrame(bool full) {
    if (!liveMode)
        beginLive();
    frameDirty = full;
    if (full) {
        std::fill(current.begin(), current.end(), Reading{});
        std::fill_n(choices, 4, nullptr);
    }
}
template <size_t N> static void storeText(std::string &storage, const Field *fields, const char *(&parts)[N]) {
    storage.clear();
    for (size_t i = 0; i < N; ++i) {
        storage.append(fields[i]);
        storage.push_back(0);
    }
    const char *p = storage.data();
    for (size_t i = 0; i < N; ++i) {
        parts[i] = p;
        p += fields[i].size() + 1;
    }
}
void marker(unsigned i, unsigned aspect, unsigned kind, const Field *fields) {
    const char *p[5];
    storeText(liveText[i], fields, p);
    current[i] = {aspect, kind, p[0], {p[1], p[2], p[3], p[4]}};
    frameDirty = true;
}
void card(unsigned i, const Field *fields, uint32_t identity) {
    const char *p[4];
    storeText(liveCardText[i], fields, p);
    liveCards[i] = {p[0], p[1], p[2], p[3], identity};
    choices[i] = identity ? &liveCards[i] : nullptr;
    frameDirty = true;
}
void finishFrame(unsigned status, uint32_t observed, uint32_t now) {
    if (frameDirty || feedStatus != status || observedAt / 60 != observed / 60 || offline) {
        trackSelection(selected);
        invalidate();
    }
    #ifdef TRANSPORT_CORE
    watchChanged=true;
    #endif
    feedStatus = status;
    observedAt = observed;
    offline = false;
    refreshCards(now);
}
void stale() {
    if (!offline) {
        offline = true;
#ifdef TRANSPORT_CORE
        watchChanged=true;
#endif
        invalidate();
    }
}
} // namespace input
} // namespace hemel
