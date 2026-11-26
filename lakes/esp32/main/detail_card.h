#pragma once
#include <algorithm>
#include <cctype>
#include <cmath>
#include <string>
#include <vector>

namespace lakes::detail {
struct Stop {
    std::string name, town;
    int at, routes;
    bool exact;
};
inline std::vector<int> summary(const std::vector<Stop> &stops, int now) {
    if (stops.empty())
        return {};
    const int last = int(stops.size()) - 1;
    int first = 0;
    while (first <= last && stops[first].at < now)
        ++first;
    if (first > last)
        return {last};
    std::vector<int> kept{first};
    if (first != last)
        kept.push_back(last);
    while (kept.size() < 6 && int(kept.size()) < last - first + 1) {
        int best = -1;
        float bestScore = -1;
        for (int i = first + 1; i < last; ++i) {
            const auto &s = stops[i];
            int gap = last - first;
            bool newTown = !s.town.empty();
            for (int k : kept) {
                gap = std::min(gap, std::abs(k - i));
                if (s.town == stops[k].town)
                    newTown = false;
            }
            if (!gap)
                continue;
            auto name = s.name;
            std::transform(name.begin(), name.end(), name.begin(),
                           [](unsigned char c) { return std::tolower(c); });
            bool hub = name.find("interchange") != name.npos || name.find("bus station") != name.npos ||
                       name.find("rail station") != name.npos || name.find("railway station") != name.npos;
            float score =
                15 * hub + 9 * s.exact + 10 * newTown + std::min(4, s.routes) + 30.f * gap / (last - first);
            if (score > bestScore) {
                best = i;
                bestScore = score;
            }
        }
        kept.push_back(best);
    }
    std::sort(kept.begin(), kept.end());
    return kept;
}
} // namespace lakes::detail
