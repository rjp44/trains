#include "source.h"
#include "esp_log.h"
#include "panel.h"

namespace {
bool receivedSnapshot;
bool replayOnly;
}

void setManualReplay(bool enabled) {
    replayOnly = enabled;
    receivedSnapshot = false;
}

bool wifi_needs_snapshot() { return !receivedSnapshot; }

void wifi_packet(const char *bytes, size_t length, uint32_t now) {
    if (replayOnly) return;
    bool first = !receivedSnapshot;
    if (first) hemel::linkEnded();
    receivedSnapshot = true;
    hemel::feedInput(bytes, length, now);
    if (first && hemel::isLive()) ESP_LOGI("feed", "Wi-Fi projection received");
}
