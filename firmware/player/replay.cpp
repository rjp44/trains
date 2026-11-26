#include "replay.h"
#include <algorithm>
#include <cstring>
#include <utility>

namespace transport {
namespace {
struct Reader {
    const uint8_t *p, *end;
    bool ok = true;
    uint32_t num(unsigned n) {
        if (size_t(end - p) < n) {
            ok = false;
            return 0;
        }
        uint32_t v = 0;
        for (unsigned i = 0; i < n; ++i)
            v |= uint32_t(*p++) << (8 * i);
        return v;
    }
    std::string text() {
        auto n = num(1);
        if (n > 250 || size_t(end - p) < n) {
            ok = false;
            return {};
        }
        auto first = p;
        p += n;
        for (auto it = first; it != p; ++it)
            if (*it < 32 || *it > 126)
                ok = false;
        return std::string(reinterpret_cast<const char *>(first), n);
    }
    bool done() const { return ok && p == end; }
};
uint32_t checksum(const uint8_t *data, size_t length) {
    uint32_t crc = ~0u;
    for (size_t i = 0; i < length; ++i) {
        crc ^= data[i];
        for (int j = 0; j < 8; ++j)
            crc = (crc >> 1) ^ ((crc & 1) ? 0xedb88320u : 0u);
    }
    return ~crc;
}
template <class T> const T *find(const std::vector<T> &rows, const std::string &id) {
    for (auto &r : rows)
        if (r.id == id)
            return &r;
    return nullptr;
}
bool id(const std::string &s) {
    auto alnum = [](char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    };
    return !s.empty() && alnum(s.front()) && std::all_of(s.begin(), s.end(), [&](char c) {
        return alnum(c) || c == '.' || c == '_' || c == '-';
    });
}
} // namespace
bool mount(const uint8_t *bytes, size_t size, Package &active) {
    constexpr unsigned header = 52;
    if (size < header || size > maxPackage || memcmp(bytes, "TDP1", 4))
        return false;
    Reader dir{bytes + 4, bytes + header}, parts[4]{};
    size_t next = header;
    for (auto &r : parts) {
        auto offset = dir.num(4), length = dir.num(4), crc = dir.num(4);
        if (offset != next || !length || length > size - next || checksum(bytes + next, length) != crc)
            return false;
        r = {bytes + next, bytes + next + length};
        next += length;
    }
    Package p{};
    auto &m = parts[0], &s = parts[1], &r = parts[2];
    p.app = m.text();
    p.version = m.text();
    if (m.text() != "station-pair-replay/1")
        return false;
    m.text(); // Attribution and licence travel in the package.
    p.stationId = s.text();
    p.stationName = s.text();
    p.x = s.num(2);
    if (!id(p.app) || !id(p.version) || !id(p.stationId) || p.x < 90 || p.x > 920 || s.num(1) != 2)
        return false;
    for (int i = 0; i < 2; ++i) {
        Track t{s.text(), s.text(), s.text(), int(s.num(2))};
        if (!id(t.id) || find(p.tracks, t.id) || t.y < 80 || t.y > 560 ||
            (t.direction != "down" && t.direction != "up"))
            return false;
        p.tracks.push_back(std::move(t));
    }
    if (p.tracks[0].direction == p.tracks[1].direction)
        return false;
    unsigned n = s.num(1);
    if (n < 1 || n > 32)
        return false;
    for (unsigned i = 0; i < n; ++i) {
        Berth b{s.text(), s.text(), int(int16_t(s.num(2))), s.text(), s.text()};
        if (!id(b.id) || find(p.berths, b.id) || !find(p.tracks, b.track) || p.x + b.offset < 120 ||
            p.x + b.offset > 990 || (b.stage != "station" && b.stage != "approach" && b.stage != "exit") ||
            (b.stage == "station" && b.offset))
            return false;
        p.berths.push_back(std::move(b));
    }
    for (auto &t : p.tracks)
        if (std::count_if(p.berths.begin(), p.berths.end(),
                          [&](const Berth &b) { return b.track == t.id && b.stage == "station"; }) != 1)
            return false;
    p.card = {int(s.num(2)), int(s.num(2)), int(s.num(2)), int(s.num(2))};
    const Box &c = p.card;
    if (c.width < 240 || c.height < 58 || c.x + c.width > 1024 || c.y + c.height > 600)
        return false;
    p.service = r.text();
    p.head = r.text();
    p.route = r.text();
    p.booked = r.text();
    auto digit = [](char a) { return a >= '0' && a <= '9'; };
    if (!id(p.service) || p.head.size() != 4 || !digit(p.head[0]) || p.head[1] < 'A' || p.head[1] > 'Z' ||
        !digit(p.head[2]) || !digit(p.head[3]) || p.booked.size() != 5 || !digit(p.booked[0]) ||
        !digit(p.booked[1]) || p.booked.substr(0, 2) > "23" || p.booked[2] != ':' || p.booked[3] < '0' ||
        p.booked[3] > '5' || !digit(p.booked[4]))
        return false;
    n = r.num(1);
    if (!n || n > 128)
        return false;
    for (unsigned i = 0; i < n; ++i) {
        Observation f{r.num(4), r.text(), r.num(1), r.text()};
        if (f.at > 86400000 || (i ? f.at <= p.frames.back().at : f.at != 0) || f.matched > 1 ||
            (!f.berth.empty() && !find(p.berths, f.berth)))
            return false;
        p.frames.push_back(std::move(f));
    }
    if (next != size || !m.done() || !s.done() || !r.done())
        return false;
    active = std::move(p);
    return true;
}
State seek(const Package &p, uint32_t ms) {
    State s{nullptr, nullptr, nullptr, false, -1, {}, false};
    for (const auto &f : p.frames) {
        if (f.at > ms)
            break;
        const Berth *b = find(p.berths, f.berth);
        const Track *t = b ? find(p.tracks, b->track) : nullptr;
        if (s.frame && b && b != s.berth && b->stage == "station") {
            s.entryMs = f.at;
            s.entryDirection = t->direction;
            s.bookedEntry = f.matched;
        }
        s.frame = &f;
        s.berth = b;
        s.track = t;
    }
    s.card = s.berth && (s.berth->stage == "station" || (s.berth->stage == "approach" && s.frame->matched));
    return s;
}
void draw(const Package &p, const State &s, Painter g) {
    constexpr unsigned bg = 0x112827, ink = 0xe5f0e6, muted = 0xabc3b6, rail = 0x79938b, amber = 0xffcb65;
    g.rect(0, 0, 1024, 600, bg);
    g.text(22, 16, p.stationName, ink, 550);
    g.text(798, 16, "Recorded movement", muted, 215);
    int top = std::min(p.tracks[0].y, p.tracks[1].y), bottom = std::max(p.tracks[0].y, p.tracks[1].y);
    g.rect(p.x - 15, top - 40, 30, bottom - top + 64, 0x254b44);
    g.text(p.x - 22, top - 72, p.stationId, ink, 65);
    for (const auto &t : p.tracks) {
        g.text(16, t.y - 10, t.name, ink, 103);
        g.rect(115, t.y - 1, 890, 3, rail);
        g.rect(p.x - 17, t.y + 8, 35, 4, muted);
        for (const auto &b : p.berths)
            if (b.track == t.id)
                g.rect(p.x + b.offset - 1, t.y - 7, 3, 15, rail);
    }
    if (s.berth) {
        int x = p.x + s.berth->offset, y = s.track->y;
        g.rect(x - 24, y - 14, 49, 27, amber);
        g.text(x - 20, y - 11, p.head, bg, 44);
    }
    if (!s.card)
        return;
    const Box &c = p.card;
    g.rect(c.x, c.y, c.width, c.height, 0x21433e);
    g.rect(c.x, c.y, 4, c.height, amber);
    int x = c.x + 13, width = c.width - 22, step = (c.height - 6) / 3;
    g.text(x, c.y + 2, p.head + "   " + s.track->name + " | " + s.berth->context, amber, width);
    if (s.frame->matched) {
        g.text(x, c.y + 2 + step, p.route, ink, width);
        g.text(x, c.y + 2 + 2 * step, s.frame->timing, muted, width);
    } else
        g.text(x, c.y + 2 + step, "Service details unavailable", muted, width);
}
} // namespace transport
