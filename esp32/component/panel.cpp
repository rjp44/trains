#include "panel.h"
#include "input.h"
#include <string>
#include <cstdlib>
#include <cstdio>
#include <algorithm>
#include <array>
#include <cstring>

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
};
struct Label {
    int16_t x, y, width;
    int8_t font, ink, background;
    const char *text;
    uint8_t preset;
};
struct Marker {
    uint16_t id;
    int16_t x, y, signalY, radius;
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
    const char *service, *route, *running;
};
struct MarkerInfo {
    const char *id, *signal, *bit, *track;
};
struct Reading {
    unsigned aspect = 0, kind = 0;
    const char *head = "";
    Detail detail{"", "", ""};
};
#include "panel_assets.h"

const Scene *scene = &sectorScene;
const Recording *recording = &sectorRecording;
const uint32_t *palette = darkPalette;
lv_obj_t *screen = nullptr;
std::array<Reading, markerCount> current{};
bool liveMode = false, offline = false, frameDirty = false;
unsigned feedStatus = 0;
uint32_t observedAt = 0;
std::array<std::string, markerCount> liveText;
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
void box(lv_layer_t *layer, int x, int y, int w, int h, int fill, int edge = -1, int radius = 0) {
    if (w <= 0 || h <= 0)
        return;
    lv_area_t bounds{x, y, x + w - 1, y + h - 1};
    lv_draw_rect_dsc_t d;
    lv_draw_rect_dsc_init(&d);
    d.bg_color = colour(fill);
    d.radius = radius;
    if (edge >= 0) {
        d.border_color = colour(edge);
        d.border_width = 1;
    }
    lv_draw_rect(layer, &d, &bounds);
}
void text(lv_layer_t *layer, int x, int cy, int w, const char *s, int size, int ink, bool centred = true) {
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
    d.color = colour(ink);
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
    box(layer, m.x - r, m.signalY - r, 2 * r + 1, 2 * r + 1, aspect == 1 ? ink : Board, ink,
        LV_RADIUS_CIRCLE);
}
void badge(lv_layer_t *layer, const Marker &m, int width) {
    const auto &train = current[m.id];
    const int h = scene->badgeHeight;
    int x = m.x - width / 2;
    box(layer, x, m.y - h / 2, width, h,
        offline           ? Stale
        : train.kind == 1 ? TrainFill
        : train.kind == 2 ? Other
                          : Stale,
        -1, 3);
    text(layer, x, m.y, width, train.head, std::min(16, h - 2), TrainText);
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
template <class Visitor> void visitBadges(Visitor visit) {
    const Marker *prev = nullptr;
    int prevWidth = 0;
    // Marker coordinates are ordered by lane, then column. Size a badge to
    // the closest occupied neighbour on either side, preserving its centre.
    for (const Marker &m : scene->markers) {
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
    return {std::clamp(selected.x - w / 2, 4, panelWidth - w - 4),
            std::clamp(selected.y > h + 20 ? selected.y - h - 14 : selected.y + 14, 4, panelHeight - h - 4),
            w, h};
}
void follow() {
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
void drawControls(lv_layer_t *layer) {
    const char *viewName = scene == &hemelScene ? "Hemel" : scene == &watfordScene ? "Watford" : "15 miles";
    const char *labels[] = {viewName, palette == darkPalette ? "Light" : "Dark"};
    for (int i = 0; i < 2; ++i) {
        auto r = button(i);
        box(layer, r.x, r.y, r.w, r.h, Board, Edge, 4);
        text(layer, r.x, r.y + r.h / 2, r.w, labels[i], 12, Text);
    }
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
    if (selected.index < 0)
        return;
    const auto r = popup();
    const auto &m = markerInfo[selected.index];
    const int x = r.x + 9, w = r.w - 18;
    box(layer, r.x, r.y, r.w, r.h, Board, HemelEdge, 5);
    text(layer, r.x + r.w - 34, r.y + 16, 28, "X", 14, Text);
    const std::string where = std::string(m.track) + " | " + m.id;
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
    selected.index = id;
    selected.x = x;
    selected.y = y;
    selected.head = current[id].head;
    follow();
    invalidate();
}
void tap(int x, int y) {
    if (selected.index >= 0) {
        const auto r = popup();
        if (r.contains(x, y)) {
            if (x >= r.x + r.w - 40 && y < r.y + 36)
                dismiss();
            return;
        }
        dismiss();
    }
    if (button(0).contains(x, y)) {
        view(scene == &sectorScene ? View::Hemel : scene == &hemelScene ? View::Watford : View::Sector);
        return;
    }
    if (button(1).contains(x, y)) {
        toggleLight();
        return;
    }
    for (int line = 0; line < 2; ++line) {
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
            const int dx = m.x - x, dy = m.signalY - y, d = dx * dx + dy * dy,
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
        if (label.preset && std::abs(x - label.x) <= label.width / 2 && std::abs(y - label.y) <= 12) {
            view(label.preset == 1 ? View::Hemel : View::Watford);
            return;
        }
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
    for (const auto &s : scene->lines) {
        lv_draw_line_dsc_t d;
        lv_draw_line_dsc_init(&d);
        d.p1.x = s.x1;
        d.p1.y = s.y1;
        d.p2.x = s.x2;
        d.p2.y = s.y2;
        d.color = colour(s.ink);
        d.width = s.width;
        lv_draw_line(layer, &d);
    }
    for (const auto &l : scene->labels) {
        const int x = l.x - l.width / 2, h = font(l.font)->line_height + 2;
        if (l.background >= 0)
            box(layer, x, l.y - h / 2, l.width, h, l.background, l.background == HemelBand ? HemelEdge : Edge,
                3);
        text(layer, x, l.y, l.width, l.text, l.font, l.ink);
    }
    for (const auto &m : scene->markers) {
        if (m.radius)
            signal(layer, m, offline ? 0 : current[m.id].aspect);
    }
    visitBadges([&](const Marker &m, int w) { badge(layer, m, w); });
    for (int i = 0; i < 2; ++i)
        if (rotation[i].shown && !offline)
            card(layer, i, *rotation[i].shown);
    drawControls(layer);
}
void reset() {
    current.fill({});
    nextFrame = nextChange = cursor = 0;
    std::fill_n(choices, 4, nullptr);
    selected = {};
    rotation[0] = {};
    rotation[1] = {};
    invalidate();
}
} // namespace
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
void view(View value) {
    dismiss();
    scene = value == View::Hemel ? &hemelScene : value == View::Watford ? &watfordScene : &sectorScene;
    invalidate();
}
void light(bool enabled) {
    palette = enabled ? lightPalette : darkPalette;
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
        follow();
        invalidate();
    }
    refreshCards(wall);
}
void refreshCards(uint32_t wall) {
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
        current.fill({});
        std::fill_n(choices, 4, nullptr);
    }
}
static void storeText(std::string &storage, const Field *fields, const char **parts) {
    storage.clear();
    for (int i = 0; i < 4; ++i) {
        storage.append(fields[i]);
        storage.push_back(0);
    }
    const char *p = storage.data();
    for (int i = 0; i < 4; ++i) {
        parts[i] = p;
        p += fields[i].size() + 1;
    }
}
void marker(unsigned i, unsigned aspect, unsigned kind, const Field *fields) {
    const char *p[4];
    storeText(liveText[i], fields, p);
    current[i] = {aspect, kind, p[0], {p[1], p[2], p[3]}};
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
        follow();
        invalidate();
    }
    feedStatus = status;
    observedAt = observed;
    offline = false;
    refreshCards(now);
}
void stale() {
    if (!offline) {
        offline = true;
        invalidate();
    }
}
} // namespace input
} // namespace hemel
