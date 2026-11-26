#pragma once
#include <array>
#include <cstdint>
#include <ctime>

namespace transport {
struct SunDay {
    int64_t rise{}, set{};
    bool isDaylight(time_t now) const { return now >= rise && now < set; }
};
struct SunWeek {
    int64_t fetched{};
    std::array<SunDay, 7> days{};

    bool valid() const {
        if (fetched < 1700000000) return false;
        int64_t previous = 0;
        for (const auto &d : days) {
            if (d.rise < 1700000000 || d.set <= d.rise || d.set - d.rise >= 86400 ||
                (previous && (d.rise - previous < 23*3600 || d.rise - previous > 25*3600))) return false;
            previous = d.rise;
        }
        return true;
    }
    const SunDay *today(time_t now) const {
        // UK sunrise and sunset occur on the same UTC and local calendar date.
        // Use local midnight at the point of observation, including the BST change.
        tm local{};
        if (!localtime_r(&now, &local)) return nullptr;
        const auto ukDay = (int64_t(now) + (local.tm_isdst > 0 ? 3600 : 0)) / 86400;
        for (const auto &d : days)
            if (d.rise && d.rise / 86400 == ukDay) return &d;
        return nullptr;
    }
};
} // namespace transport
