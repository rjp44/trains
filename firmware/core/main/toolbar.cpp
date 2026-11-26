#include "toolbar.h"
#include <algorithm>
#include <cmath>

namespace transport {
namespace {
constexpr int margin = 6, buttonWidth = 48, buttonHeight = 44, top = 4;
constexpr uint16_t rgb(unsigned c) {
    return ((c >> 8) & 0xf800) | ((c >> 5) & 0x07e0) | ((c >> 3) & 31);
}
enum Icon { Gear, Sun, Moon };
// Rasterize the three small glyphs once, with four coverage samples per pixel.
bool insideIcon(Icon icon, float x, float y) {
    float r = std::hypot(x, y), angle = std::atan2(y, x);
    if (icon == Gear) {
        float teeth = std::cos(8 * angle);
        return r > 3.6f && r < 8.7f + std::clamp(teeth * 3, -1.8f, 1.8f);
    }
    if (icon == Moon) return r < 9.5f && std::hypot(x - 4.2f, y + 3.5f) > 8.2f;
    return (r > 3.5f && r < 5.7f) || (r >= 7.7f && r < 10.8f && std::abs(std::sin(4 * angle)) * r < 3.6f);
}
struct Masks {
    uint8_t alpha[3][24][24]{};
    Masks() {
        for (Icon i : {Gear, Sun, Moon})
            for (int y = 0; y < 24; ++y)
                for (int x = 0; x < 24; ++x)
                    for (float dy : {0.25f, 0.75f})
                        for (float dx : {0.25f, 0.75f})
                            alpha[i][y][x] += insideIcon(i, x + dx - 12, y + dy - 12);
    }
};
} // namespace
ToolbarButton toolbarButton(int x, int y, int width) {
    if (y < 0 || y >= toolbarHeight || x < 0 || x >= width) return ToolbarButton::None;
    if (x < margin + buttonWidth + 2) return ToolbarButton::Settings;
    if (x >= width - margin - buttonWidth - 2) return ToolbarButton::Theme;
    return ToolbarButton::None;
}
void drawToolbar(uint16_t *pixels, bool portrait, bool dark) {
    static const Masks masks;
    int width = portrait ? 600 : 1024;
    auto pixel = [&](int x, int y, uint16_t c) {
        pixels[portrait ? x * 1024 + 1023 - y : y * 1024 + x] = c;
    };
    const unsigned colors[] = {dark ? 0x25463eU : 0xdcebe3U, dark ? 0xf1f7f2U : 0x173e34U};
    uint16_t shades[5];
    for (int a = 0; a <= 4; ++a) {
        unsigned c = 0;
        for (int shift : {16, 8, 0})
            c |= ((((colors[0] >> shift) & 255) * (4-a) + ((colors[1] >> shift) & 255) * a) / 4) << shift;
        shades[a] = rgb(c);
    }
    for (bool right : {false, true}) {
        int left = right ? width - margin - buttonWidth : margin;
        Icon icon = right ? (dark ? Sun : Moon) : Gear;
        for (int y = 0; y < buttonHeight; ++y)
            for (int x = 0; x < buttonWidth; ++x) {
                int dx = std::max({8 - x, x - (buttonWidth - 9), 0});
                int dy = std::max({8 - y, y - (buttonHeight - 9), 0});
                if (dx * dx + dy * dy > 64) continue;
                int gx = x - (buttonWidth - 24) / 2, gy = y - (buttonHeight - 24) / 2;
                int alpha = unsigned(gx) < 24 && unsigned(gy) < 24 ? masks.alpha[icon][gy][gx] : 0;
                pixel(left + x, top + y, shades[alpha]);
            }
    }
}
} // namespace transport
