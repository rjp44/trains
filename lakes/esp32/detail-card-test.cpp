#include "main/detail_card.h"
#include <cassert>
using lakes::detail::Stop;
using lakes::detail::summary;
int main() {
    std::vector<Stop> calls;
    for (int i = 0; i < 22; ++i)
        calls.push_back({"Road", "A", 82800 + i * 300, 1, false});
    calls[10] = {"Bus Rail Interchange", "B", calls[10].at, 4, true};
    calls[16] = {"Bus Station", "C", calls[16].at, 3, true};
    auto kept = summary(calls, calls[3].at + 1);
    assert(kept.size() == 6 && kept.front() == 4 && kept.back() == 21);
    for (int id : {10, 16})
        assert(std::find(kept.begin(), kept.end(), id) != kept.end());
    assert(std::is_sorted(kept.begin(), kept.end()));
    assert((summary(calls, calls[20].at) == std::vector<int>{20, 21}));
    assert((summary(calls, calls[21].at + 1) == std::vector<int>{21}));
    assert(summary({}, 0).empty());
}
