#pragma once
#include "display.h"
#include <cmath>

namespace transport {
struct Point { int x{}, y{}; };
enum class ContactEvent { None, SingleEnd, PinchStart, PinchMove, PinchEnd };

inline bool pinchThreshold(float initial, float current, bool schematic) {
    const float factor = schematic ? 1.25f : 1.08f;
    return std::abs(current - initial) >= (schematic ? 18.f : 10.f) &&
           (current >= initial * factor || current <= initial / factor);
}

// Delay map taps until release. After a pinch, lifting the last finger cannot select a train.
struct Gesture {
    Point start{}, last{}, centre{};
    float span{};
    bool down{}, multi{}, dragged{};
    ContactEvent sample(const TouchFrame &f) {
        if (f.count == 0) {
            auto event = multi ? ContactEvent::PinchEnd : down ? ContactEvent::SingleEnd : ContactEvent::None;
            multi = down = false;
            return event;
        }
        if (f.count >= 2) {
            const auto &a = f.points[0], &b = f.points[1];
            centre = {(a.x + b.x) / 2, (a.y + b.y) / 2};
            span = std::hypot(float(a.x - b.x), float(a.y - b.y));
            bool first = !multi;
            multi = true;
            return first ? ContactEvent::PinchStart : ContactEvent::PinchMove;
        }
        if (!multi) {
            last = {f.points[0].x, f.points[0].y};
            if (!down) { start = last; dragged = false; }
            if (std::abs(last.x - start.x) + std::abs(last.y - start.y) > 14) dragged = true;
            down = true;
        }
        return ContactEvent::None;
    }
};
} // namespace transport
