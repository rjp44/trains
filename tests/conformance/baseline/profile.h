#pragma once
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include <cstdio>

// Called only on the original app's render thread in a TRANSPORT_PROFILE build.
// Timestamp first so obtaining heap statistics and writing UART do not enter the sample.
inline void profileFrame(const char *app, bool live, int64_t start) {
    const int64_t end = esp_timer_get_time();
    static int64_t last = -10000000;
    static bool previousLive = false;
    if (live == previousLive && end - last < 10000000) return;
    last = end;
    previousLive = live;
    constexpr unsigned internal = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
    constexpr unsigned external = MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT;
    printf("BASELINE %s live=%d uptime_ms=%lld frame_us=%lld internal_total=%u internal_min=%u "
           "psram_total=%u psram_min=%u\n", app, live, end/1000, end-start,
           unsigned(heap_caps_get_total_size(internal)), unsigned(heap_caps_get_minimum_free_size(internal)),
           unsigned(heap_caps_get_total_size(external)), unsigned(heap_caps_get_minimum_free_size(external)));
}
