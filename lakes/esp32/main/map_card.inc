// Draw into the same back buffer as the selected marker. Coordinates here are logical map pixels.
int clipTop, clipBottom;
void cardRect(int x, int y, int w, int h, uint16_t c) {
    int first = std::max(y, clipTop), last = std::min(y + h, clipBottom);
    if (last > first)
        rect(x, first, w, last - first, c);
}
void rounded(Rect r, int radius, uint16_t c) {
    radius = std::min({radius, r.h / 2, r.w / 2});
    for (int i = 0; i < r.h; ++i) {
        int dy = std::max({radius - 1 - i, i - (r.h - radius), 0});
        int inset = dy ? radius - int(std::sqrt(radius * radius - dy * dy)) : 0;
        cardRect(r.x + inset, r.y + i, r.w - 2 * inset, 1, c);
    }
}
int cardWidth(const std::string &s, float size) {
    return std::lround(textWidth(s) * size);
}
void cardLabel(int x, int y, const std::string &s, uint16_t c, float size = 1, bool bold = false) {
    // The atlas is antialiased. Sample it at the heading, body and caption sizes.
    int pen = 0;
    for (unsigned char ch : s) {
        if (ch < 32 || ch >= 127)
            continue;
        int glyph = ch - 32, advance = advances[glyph], left = x + std::lround(pen * size);
        auto mask = fontMask + glyph * 19 * 23;
        int width = std::min(19, advance + 1);
        for (int j = 0; j < int(23 * size); ++j) {
            if (y + j < clipTop || y + j >= clipBottom)
                continue;
            float v = j / size;
            int v0 = int(v), v1 = std::min(22, v0 + 1);
            for (int i = 0; i < int(width * size); ++i) {
                float u = i / size;
                int u0 = int(u), u1 = std::min(width - 1, u0 + 1);
                auto sample = [&](int row) {
                    float a = mask[row * 19 + u0], b = mask[row * 19 + u1];
                    return a + (b - a) * (u - u0);
                };
                float a = sample(v0);
                int alpha = std::lround(a + (sample(v1) - a) * (v - v0));
                if (!alpha)
                    continue;
                for (int k = 0; k <= int(bold); ++k) {
                    int xx = left + i + k;
                    if (unsigned(xx) >= unsigned(W))
                        continue;
                    auto &pixel = pixels[offset(xx, y + j)];
                    pixel = blend(pixel, c, alpha);
                }
            }
        }
        pen += advance;
    }
}
std::vector<std::string> wrapCard(const std::string &value, int width, float size) {
    std::vector<std::string> lines;
    std::string line;
    size_t start = 0;
    while (start < value.size()) {
        auto end = value.find(' ', start);
        if (end == value.npos)
            end = value.size();
        auto word = value.substr(start, end - start);
        if (word.empty()) {
            start = end + 1;
            continue;
        }
        if (!line.empty() && cardWidth(line + " " + word, size) > width) {
            lines.push_back(line);
            line.clear();
        }
        if (!line.empty())
            line += " ";
        for (char c : word) {
            if (!line.empty() && cardWidth(line + c, size) > width) {
                lines.push_back(line);
                line.clear();
            }
            line += c;
        }
        start = end + 1;
    }
    if (!line.empty())
        lines.push_back(line);
    return lines;
}
Rect placeCard(int w, int h) {
    constexpr int margin = 8, gap = 9;
    const int ax = anchor.x + anchor.w / 2, ay = anchor.y + anchor.h / 2;
    Rect best{};
    int lowest = INT32_MAX;
    for (Rect r :
         {Rect{anchor.x + anchor.w + gap, ay - h / 2, w, h}, Rect{anchor.x - gap - w, ay - h / 2, w, h},
          Rect{ax - w / 2, anchor.y - gap - h, w, h}, Rect{ax - w / 2, anchor.y + anchor.h + gap, w, h}}) {
        int x = std::clamp(r.x, margin, W - margin - w),
            y = std::clamp(r.y, top + margin, bottom - margin - h);
        int cost = std::abs(x - r.x) + std::abs(y - r.y);
        if (overlaps({x, y, w, h}, anchor))
            cost += 10000;
        if (cost < lowest) {
            best = {x, y, w, h};
            lowest = cost;
        }
    }
    return best;
}
void card() {
    if (selection.empty() && stopSelection < 0)
        return;
    constexpr int pad = 15, timeCol = 74, toggleCol = 44;
    constexpr float caption = .81f, heading = 1.20f;
    int badgeW = cardWidth(badge, .9f) + 16;
    int w = std::max(badgeW + cardWidth(subtitle, caption) + 59, cardWidth(title, heading) + 2 * pad);
    w = std::max(w, cardWidth(section, caption) + 2 * pad);
    for (const auto &r : details) {
        int fixed = 2 * pad + (r.time.empty() ? 0 : timeCol) + (r.hidden ? toggleCol : 0);
        w = std::max(w, fixed + std::max(cardWidth(r.name, 1), cardWidth(r.note, caption)));
    }
    w = std::clamp(w + 3, 160, std::min(W - 16, 376));
    auto titleLines = wrapCard(title, w - 2 * pad, heading);
    int headerH = 46 + 25 * int(titleLines.size()) + (section.empty() ? 1 : 22);
    struct Lines {
        std::vector<std::string> names, notes;
        int height;
    };
    std::vector<Lines> lines;
    int contentH = 0;
    for (const auto &r : details) {
        int room = w - 2 * pad - (r.time.empty() ? 0 : timeCol) - (r.hidden ? toggleCol : 0) - 3;
        auto names = wrapCard(r.name, room, 1), notes = wrapCard(r.note, room, caption);
        int h = std::max(r.hidden ? 40 : 31, 12 + 20 * int(names.size()) + 16 * int(notes.size()));
        lines.push_back({std::move(names), std::move(notes), h});
        contentH += h;
    }
    int maxH = std::min(bottom - top - 16, 482);
    int h = std::min(maxH, headerH + contentH + 9);
    cardBox = placeCard(w, h);
    const int x = cardBox.x, y = cardBox.y, listY = y + headerH, endY = y + h - 8;
    clipTop = top;
    clipBottom = bottom;
    // A short leader identifies the anchor even beside other vehicles at an interchange.
    int ax = anchor.x + anchor.w / 2, ay = anchor.y + anchor.h / 2;
    int ex = std::clamp(ax, x + 4, x + w - 5), ey = std::clamp(ay, y + 4, y + h - 5);
    int length = std::max(std::abs(ex - ax), std::abs(ey - ay));
    for (int i = 1; i <= length; ++i) {
        int px = ax + (ex - ax) * i / length, py = ay + (ey - ay) * i / length;
        if (px >= anchor.x && px < anchor.x + anchor.w && py >= anchor.y && py < anchor.y + anchor.h)
            continue;
        cardRect(px - 1, py - 1, 3, 3, accent);
    }
    uint16_t surface = color(dark ? 0x213831 : 0xfffef7);
    if (!selection.empty()) {
        int radius = std::max(8, anchor.w / 2 - 1);
        for (int j = -radius - 1; j <= radius + 1; ++j)
            for (int i = -radius - 1; i <= radius + 1; ++i) {
                int r2 = i * i + j * j;
                if (r2 > (radius + 1) * (radius + 1) || r2 < (radius - 1) * (radius - 1))
                    continue;
                pixel(ax + i, ay + j, r2 >= radius * radius ? surface : accent);
            }
    }
    for (int j = 0; j < h + 8; ++j) {
        int yy = y + j - 1;
        if (yy < top || yy >= bottom)
            continue;
        for (int i = 0; i < w + 8; ++i) {
            int xx = x + i - 4;
            if (xx < 0 || xx >= W || (i >= 7 && i < w && j >= 5 && j < h))
                continue;
            int dx = std::max({15 - i, i - (w - 8), 0}), dy = std::max({15 - j, j - (h - 8), 0});
            int fade = std::clamp(15 - int(std::sqrt(dx * dx + dy * dy)), 0, 5);
            auto &bg = pixels[offset(xx, yy)];
            bg = blend(bg, color(0x112c22), fade * 10);
        }
    }
    rounded(cardBox, 13, edge);
    rounded({x + 1, y + 1, w - 2, h - 2}, 12, surface);
    rounded({x + pad, y + 12, badgeW, 23}, 7, accent);
    cardLabel(x + pad + 8, y + 14, badge, color(0xffffff), .9f, true);
    cardLabel(x + pad + badgeW + 8, y + 16, subtitle, muted, caption);
    for (int d = -5; d <= 5; ++d) {
        cardRect(x + w - 20 + d, y + 22 + d, 2, 2, muted);
        cardRect(x + w - 20 + d, y + 22 - d, 2, 2, muted);
    }
    int ty = y + 39;
    for (auto &s : titleLines) {
        cardLabel(x + pad, ty, s, ink, heading, true);
        ty += 25;
    }
    if (!section.empty())
        cardLabel(x + pad, ty + 3, section, muted, caption);
    cardRect(x + pad, listY - 1, w - 2 * pad, 1, blend(surface, edge, 165));
    hits.push_back({cardBox, CardBody, -1});
    hits.push_back({{x + w - 40, y + 2, 38, 38}, Close, -1});
    clipTop = listY;
    clipBottom = endY;
    maxScroll = std::max(0, contentH - (endY - listY));
    scrollY = std::clamp(scrollY, 0, maxScroll);
    int ry = listY - scrollY;
    for (size_t i = 0; i < details.size(); ++i) {
        const auto &r = details[i];
        const auto &l = lines[i];
        int next = ry + l.height;
        if (next > listY && ry < endY) {
            int left = x + pad;
            if (!r.time.empty()) {
                cardLabel(left, ry + 6, r.time, r.intermediate ? muted : ink, .92f);
                int tx = left + timeCol - 11;
                cardRect(tx, ry, 2, l.height, blend(surface, accent, 65));
                rounded({tx - 2, ry + 13, 6, 6}, 3, r.intermediate ? edge : accent);
                left += timeCol;
            }
            int yy = ry + 5;
            for (const auto &s : l.names) {
                cardLabel(left, yy, s, r.intermediate ? muted : ink, 1, !i && !r.time.empty());
                yy += 20;
            }
            for (const auto &s : l.notes) {
                cardLabel(left, yy, s, muted, caption);
                yy += 16;
            }
            if (r.hidden) {
                int bx = x + w - pad - toggleCol + 3, by = ry + (l.height - 25) / 2;
                rounded({bx, by, toggleCol - 4, 25}, 7, blend(surface, accent, dark ? 52 : 22));
                cardLabel(bx + 5, by + 4, std::to_string(r.hidden), ink, caption, true);
                for (int j = 0; j < 5; ++j) {
                    int yy = by + 10 + (expanded == r.toggle ? -j : j);
                    cardRect(bx + toggleCol - 20 + j, yy, 2, 2, ink);
                    cardRect(bx + toggleCol - 12 - j, yy, 2, 2, ink);
                }
                int hitY = std::max(ry, listY);
                hits.push_back({{x + 2, hitY, w - 4, std::min(next, endY) - hitY}, ToggleStops, r.toggle});
            }
        }
        ry = next;
    }
    if (maxScroll) {
        int viewport = endY - listY, thumb = std::max(14, viewport * viewport / contentH);
        rounded({x + w - 5, listY + (viewport - thumb) * scrollY / maxScroll, 3, thumb}, 1, edge);
    }
    clipTop = top;
    clipBottom = bottom;
}
