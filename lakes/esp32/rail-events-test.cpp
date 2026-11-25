#include "rail_events.h"
#include <cassert>

int main() {
    lakes::Vehicle v;
    v.route = 8;
    v.id = "rail-1";
    v.direction = -1;
    v.lastCode = "KEN";
    v.time = 100000;
    lakes::Snapshot before, after;
    before.link = after.link = 5;
    before.railOk = after.railOk = true;
    constexpr int64_t now = 130000;
    auto reported = [&] { return lakes::newRailReport(before, after, v, now); };
    assert(!reported()); // initial snapshot
    before.vehicles.push_back(v);
    v.time = now;
    assert(!reported()); // estimated motion on the same leg
    v.lastCode = "BUD";
    assert(reported());
    after.railOk = false;
    assert(!reported());
    after.railOk = true;
    after.link = 7;
    assert(!reported());
    after.link = 5;
    v.route = 0;
    assert(!reported());
    v.route = 8;
    v.time = 9000;
    assert(!reported());
    v.time = now + 9000;
    assert(!reported());
}
