#include "source.h"
#include "esp_log.h"
#include "panel.h"
#include "wifi.h"

namespace {
enum class Source { Replay, Wifi, Usb };
Source source = Source::Replay;
uint32_t lastUsb;
}

void usb_input(const char *bytes, size_t length, uint32_t now) {
    if (source == Source::Wifi) hemel::linkEnded();
    source = Source::Usb;
    lastUsb = now;
    hemel::feedInput(bytes, length, now, wifi_save);
}

bool wifi_needs_snapshot() { return source != Source::Wifi; }

void wifi_packet(const char *bytes, size_t length, uint32_t now) {
    if (source == Source::Usb && now - lastUsb < 6500) return;
    bool first = source != Source::Wifi;
    if (first) hemel::linkEnded();
    source = Source::Wifi;
    hemel::feedInput(bytes, length, now);
    if (first && hemel::isLive()) ESP_LOGI("feed", "Wi-Fi projection received");
}
