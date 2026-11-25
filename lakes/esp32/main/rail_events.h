#pragma once
#include "map.h"
#include <algorithm>

namespace lakes {
// A new observation of the same leg only moves the estimated position.
inline bool newRailReport(const Snapshot &previous, const Snapshot &current, const Vehicle &v,
                          int64_t now) {
    constexpr int64_t fresh = 120000;
    if (!previous.railOk || !current.railOk || previous.link != current.link || v.route < 8 ||
        !v.direction || (v.lastCode.empty() && v.last.empty()) || v.time <= 0 || now - v.time >= fresh ||
        v.time > now + 5000)
        return false;
    const auto old =
        std::find_if(previous.vehicles.begin(), previous.vehicles.end(),
                     [&](const Vehicle &other) { return other.route == v.route && other.id == v.id; });
    return old != previous.vehicles.end() && v.time > old->time && v.time - old->time < fresh &&
           (v.lastCode != old->lastCode || (v.lastCode.empty() && v.last != old->last));
}
} // namespace lakes
