#include "panel.h"
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
};
struct Marker {
    uint16_t id;
    int16_t x, y, signalY, radius;
};
struct Scene {
    List<Segment> lines;
    List<Label> labels;
    List<Marker> markers;
    int centre, cardLeft, fastBottom, slowTop, slowBottom, badgeWidth, badgeHeight;
};
struct Change {
    uint16_t id;
    uint8_t aspect, kind;
    const char *head;
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
    uint16_t identity;
};
#include "panel_assets.h"

const Scene *scene = &sectorScene;
const Recording *recording = &sectorRecording;
const uint32_t *palette = darkPalette;
lv_obj_t *screen = nullptr;
std::array<const Change *, markerCount> current{};
size_t nextFrame = 0, nextChange = 0;
uint32_t cursor = 0;
struct Rotation {
    uint16_t first, second, shown;
    uint32_t since;
};
Rotation rotation[2]{};
const uint16_t emptyCards[4]{};
const uint16_t *candidates = emptyCards;

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
    const auto &train = *current[m.id];
    const int h = scene->badgeHeight;
    int x = m.x - width / 2;
    box(layer, x, m.y - h / 2, width, h,
        train.kind == 1   ? TrainFill
        : train.kind == 2 ? Other
                          : Stale,
        -1, 3);
    text(layer, x, m.y, width, train.head, std::min(16, h - 2), TrainText);
}
void card(lv_layer_t *layer, int line, const Card &c) {
    const int room = line ? scene->slowBottom - scene->slowTop : scene->fastBottom - 3;
    const int height = std::min(57, room);
    if (height < 16)
        return;
    int size = height >= 48 ? 12 : height >= 36 ? 10 : 8;
    int rowH = height / 3;
    const int preferred = std::max({textWidth(c.context, font(size)) + 48, textWidth(c.route, font(size)),
                                    textWidth(c.running, font(size))}) +
                          16;
    const int w = std::min(preferred, panelWidth - scene->cardLeft - 3);
    const int x = std::clamp(scene->centre - w / 2, scene->cardLeft, panelWidth - w - 3);
    const int y = line ? scene->slowTop : scene->fastBottom - height;
    box(layer, x, y, w, height, HemelBand, HemelEdge, 4);
    const int headW = textWidth(c.head, font(size)) + 8;
    box(layer, x + 5, y + 2, headW, rowH - 2, TrainFill, -1, 2);
    text(layer, x + 5, y + rowH / 2 + 1, headW, c.head, size, TrainText);
    text(layer, x + headW + 10, y + rowH / 2 + 1, w - headW - 13, c.context, size, Muted, false);
    text(layer, x + 6, y + rowH + rowH / 2, w - 12, c.route, size, Text, false);
    text(layer, x + 6, y + 2 * rowH + rowH / 2, w - 12, c.running, size, Text, false);
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
            signal(layer, m, current[m.id] ? current[m.id]->aspect : 0);
    }
    const Marker *prev = nullptr;
    int prevWidth = 0;
    // Marker coordinates are ordered by lane, then column. Size a badge to
    // the closest occupied neighbour on either side, preserving its centre.
    for (const Marker &m : scene->markers) {
        const auto *state = current[m.id];
        if (!state || !state->kind)
            continue;
        int w = scene->badgeWidth;
        if (prev) {
            if (prev->y == m.y && prev->x < m.x)
                w = std::clamp(m.x - prev->x - 2, 1, w);
            badge(layer, *prev, std::min(prevWidth, w));
        }
        prev = &m;
        prevWidth = w;
    }
    if (prev)
        badge(layer, *prev, prevWidth);
    for (int i = 0; i < 2; i++)
        if (rotation[i].shown)
            card(layer, i, cards[rotation[i].shown]);
}
void reset() {
    current.fill(nullptr);
    nextFrame = nextChange = cursor = 0;
    candidates = emptyCards;
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
    return true;
}
void view(View value) {
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
            current[delta.id] = &delta;
        }
        candidates = frame.cards;
        changed = true;
    }
    for (int i = 0; i < 2; i++) {
        auto &r = rotation[i];
        const auto first = candidates[2 * i], second = candidates[2 * i + 1];
        if (cards[first].identity != r.first || cards[second].identity != r.second) {
            r.since = wall;
            r.first = cards[first].identity;
            r.second = cards[second].identity;
        }
        const auto next = (second && (wall - r.since) / 5000 % 2) ? second : first;
        if (r.shown != next) {
            r.shown = next;
            changed = true;
        }
    }
    if (changed)
        invalidate();
}
} // namespace hemel
