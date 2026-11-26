#include "../../firmware/core/main/sunlight.h"
#include <cassert>
#include <cstdlib>

// A week straddling each UK clock change, plus winter and summer local midnight.
int main() {
    setenv("TZ", "GMT0BST,M3.5.0/1,M10.5.0/2", 1);
    tzset();
    for (int month : {1, 3, 7, 10}) {
        tm start{};
        start.tm_year = 126;
        start.tm_mon = month - 1;
        start.tm_mday = 24;
        time_t midnightUtc = timegm(&start);
        transport::SunWeek week{};
        week.fetched = midnightUtc;
        for (size_t i = 0; i < week.days.size(); ++i) {
            auto utc = midnightUtc + i * 86400;
            week.days[i] = {int64_t(utc + 7 * 3600), int64_t(utc + 17 * 3600)};
        }
        assert(week.valid());
        for (size_t i = 0; i < week.days.size(); ++i) {
            tm midnight{};
            midnight.tm_year = 126;
            midnight.tm_mon = month - 1;
            midnight.tm_mday = 24 + i;
            midnight.tm_isdst = -1;
            auto localStart = mktime(&midnight);
            const auto &day = week.days[i];
            assert(week.today(localStart) == &day);
            assert(week.today(localStart - 1) == (i ? &week.days[i - 1] : nullptr));
            assert(!day.isDaylight(day.rise - 1) && day.isDaylight(day.rise));
            assert(day.isDaylight(day.set - 1) && !day.isDaylight(day.set));
        }
        assert(!week.today(midnightUtc + 7 * 86400));
        auto invalid = week;
        invalid.days[2] = week.days[3];
        assert(!invalid.valid());
        invalid = week;
        invalid.days[2].set = invalid.days[2].rise;
        assert(!invalid.valid());
        assert(!transport::SunWeek{}.valid());
    }
}
