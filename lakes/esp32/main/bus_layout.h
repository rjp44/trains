#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>
#include <string_view>

namespace lakes::bus {
struct Vertex {
    int16_t x, y;
    float distance;
};
static_assert(sizeof(Vertex) == 8);
struct Path {
    const Vertex *points;
    unsigned count;
    float length() const { return points[count - 1].distance; }
};
struct Point {
    float x, y;
};
inline Point pointAt(Path path, float distance) {
    auto end = path.points + path.count;
    auto b = std::lower_bound(path.points + 1, end - 1, distance,
                              [](const Vertex &v, float d) { return v.distance < d; });
    const auto &a = b[-1];
    const float t = std::clamp((distance - a.distance) / (b->distance - a.distance), 0.f, 1.f);
    return {(a.x + t * (b->x - a.x)) / 8, (a.y + t * (b->y - a.y)) / 8};
}
constexpr float radians = 0.01745329252f;
inline float bearing(Path path, float distance) {
    // Four map units on each side span roughly 860 m of travelled road.
    Point a = pointAt(path, distance - 4), b = pointAt(path, distance + 4);
    if (std::hypot(b.x - a.x, b.y - a.y) < .1f)
        b = pointAt(path, distance);
    return std::fmod(std::atan2(b.x - a.x, a.y - b.y) / radians + 360.f, 360.f);
}
struct Match {
    float distance = 0, error = INFINITY;
};
inline Match nearest(Path path, Point fix, float expected) {
    Match best;
    for (unsigned i = 1; i < path.count; ++i) {
        const auto &a = path.points[i - 1], &b = path.points[i];
        float dx = (b.x - a.x) / 8.f, dy = (b.y - a.y) / 8.f;
        float x = fix.x - a.x / 8.f, y = fix.y - a.y / 8.f;
        float t = std::clamp((x * dx + y * dy) / (dx * dx + dy * dy), 0.f, 1.f);
        float along = a.distance + t * (b.distance - a.distance);
        float error = std::hypot(x - t * dx, y - t * dy);
        if (expected >= 0)
            error += .35f * std::abs(along / path.length() - expected);
        if (error < best.error)
            best = {along, error};
    }
    return best;
}
// Each offset selects the single, closed double or open double in the packed atlas.
enum class View { Side = 0, Front = 4, Roof = 7, Oblique = 10 };
inline View vehicleView(float heading, unsigned spriteCount = 13) {
    if (!(heading >= 0 && heading <= 360))
        return View::Front;
    if (spriteCount == 7)
        return View::Side;
    if (spriteCount == 10) {
        // Earlier packages carry two elevations with the original roof sectors.
        return heading >= 315 || heading <= 45 || (heading >= 135 && heading <= 205) ? View::Roof : View::Side;
    }
    float tilt = std::abs(std::fmod(heading, 180.f) - 90);
    if (tilt <= 22.5f) return View::Side;
    if (tilt >= 67.5f) return View::Roof;
    return View::Oblique;
}
inline constexpr unsigned railAtlasFrames = 16;
inline constexpr unsigned operatorAtlasFrames = 24;
inline int railSideAsset(std::string_view agency, unsigned frames) {
    if (frames < operatorAtlasFrames) return 3;
    if (agency == "Avanti West Coast" || agency == "VT" || agency == "AWC") return 16;
    if (agency == "TransPennine Express" || agency == "TP" || agency == "TPE") return 20;
    return 3;
}
struct Sprite {
    int asset;
    View view;
};
inline Sprite vehicleSprite(int sideAsset, float heading, unsigned frames) {
    if (sideAsset == 16 || sideAsset == 20) {
        const auto view = vehicleView(heading, frames);
        const int offset = view == View::Roof ? 1 : view == View::Oblique ? 2 : view == View::Front ? 3 : 0;
        return {sideAsset + offset, view};
    }
    if (sideAsset != 3) {
        View view = vehicleView(heading, frames);
        return {sideAsset + static_cast<int>(view), view};
    }
    if (frames >= railAtlasFrames) {
        switch (vehicleView(heading, frames)) {
        case View::Roof: return {13, View::Roof};
        case View::Oblique: return {14, View::Oblique};
        case View::Front: return {15, View::Front};
        case View::Side: break;
        }
    }
    return {3, View::Side};
}
struct Box {
    float x, y, w, h;
};
inline Box footprint(Point p, float heading, float unit, bool bus, unsigned spriteCount = 13) {
    float a = (heading < 0 ? 90 : heading) * radians;
    float s = std::abs(std::sin(a)), c = std::abs(std::cos(a));
    float halfHeight = bus && vehicleView(heading, spriteCount) == View::Roof ? 7.3f : 10.5f;
    float halfLength = bus ? 18.3f : 18.f;
    if (bus) {
        p.x += 2.5f * std::sin(a) * unit;
        p.y -= 2.5f * std::cos(a) * unit;
    }
    float w = (halfLength * s + halfHeight * c + 1) * unit, h = (halfLength * c + halfHeight * s + 1) * unit;
    return {p.x - w, p.y - h, 2 * w, 2 * h};
}
inline float overlap(Box a, Box b) {
    return std::max(0.f, std::min(a.x + a.w, b.x + b.w) - std::max(a.x, b.x)) *
           std::max(0.f, std::min(a.y + a.h, b.y + b.h) - std::max(a.y, b.y));
}
struct Marker {
    unsigned index;
    Point point;
    float bearing;
    int path;
    float distance;
    Box box{};
    float drawDistance{};
};
template <class Inside>
bool place(Marker &m, const std::vector<Path> &paths, const std::vector<Box> &occupied, float unit,
           Inside inside, unsigned spriteCount = 13) {
    auto cost = [&](Box b) {
        float sum = 0;
        for (const auto other : occupied)
            sum += overlap(b, other);
        return sum;
    };
    m.box = footprint(m.point, m.bearing, unit, m.path >= 0, spriteCount);
    m.drawDistance = m.distance;
    float best = cost(m.box);
    if (best == 0 || m.path < 0)
        return true;
    auto path = paths[m.path];
    const bool keepVisible = inside(m.point);
    const float step = 3 * unit, length = path.length();
    const float limit = std::max(m.distance, length - m.distance);
    for (float delta = 0; delta < limit + step; delta += step) {
        for (int sign : {-1, 1}) {
            if (!delta && sign < 0)
                continue;
            float d = m.distance + sign * delta;
            if (d <= -step || d >= length + step)
                continue;
            d = std::clamp(d, 0.f, length);
            Point p = pointAt(path, d);
            if (keepVisible && !inside(p))
                continue;
            float direction = bearing(path, d);
            Box candidate = footprint(p, direction, unit, true, spriteCount);
            float score = cost(candidate);
            if (score >= best)
                continue;
            m.point = p;
            m.bearing = direction;
            m.box = candidate;
            m.drawDistance = d;
            best = score;
            if (best == 0)
                return true;
        }
    }
    return false;
}
// Markers arrive in path/progress order. Assign the occupied slots in that order too.
inline void restoreOrder(std::vector<Marker> &markers) {
    for (auto first = markers.begin(); first != markers.end();) {
        auto end =
            std::find_if(first + 1, markers.end(), [&](const auto &m) { return m.path != first->path; });
        if (first->path >= 0 && end - first > 1) {
            std::vector<Marker> slots(first, end);
            std::stable_sort(slots.begin(), slots.end(),
                             [](const auto &a, const auto &b) { return a.drawDistance < b.drawDistance; });
            auto marker = first;
            for (const auto &slot : slots) {
                marker->point = slot.point;
                marker->bearing = slot.bearing;
                marker->box = slot.box;
                marker->drawDistance = slot.drawDistance;
                ++marker;
            }
        }
        first = end;
    }
}
} // namespace lakes::bus
