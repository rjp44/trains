#include "display.h"
#ifdef TRANSPORT_PROFILE
#include "profile.h"
#endif
#include "driver/uart.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_rom_crc.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "map.h"
#include "settings_display.h"
#include "settings_ui.h"
#include "preferences.h"
#include "wifi.h"
#include <algorithm>
#include <cstdio>
#include <string>
namespace {
uint16_t *pixels;
bool held = false;
unsigned flips = 0;
uint32_t drawMs = 0;
uint32_t now() { return esp_timer_get_time() / 1000; }
void draw() {
    uint32_t start = now();
#ifdef TRANSPORT_PROFILE
    const bool live = lakes::status().rfind("live", 0) == 0;
    const int64_t frameStart = esp_timer_get_time();
#endif
    pixels = crowpanel_back_buffer();
    lakes::render(pixels, start);
    crowpanel_present();
    drawMs = now() - start;
#ifdef TRANSPORT_PROFILE
    profileFrame("lakes", live, frameStart);
#endif
    ++flips;
}
void touch() {
    static uint16_t x = 0, y = 0, startX = 0, startY = 0;
    static bool down = false;
    bool pressed = false;
    if (!crowpanel_touch(&x, &y, &pressed))
        return;
    if (panel::settingsOpen()) {
        if (!held) lakes::settingsPointer(x, y, pressed);
        down = false;
        return;
    }
    if (pressed && !down) {
        startX = x;
        startY = y;
    }
    if (!pressed && down && !held)
        lakes::gesture(x, y, int(x) - startX, int(y) - startY, now());
    down = pressed;
}
void report() {
    printf("LAKES_STATUS wifi=%u visible=%d %s flips=%u refresh=%lu hold=%d draw_ms=%lu\n",
           unsigned(wifi_link_state() & 1), lakes::visibleCount(), lakes::status().c_str(), flips,
           (unsigned long)crowpanel_refresh_count(), held, (unsigned long)drawMs);
}
// Each row of the diagnostic capture is independent of unsolicited UART logs.
void capture() {
    const auto *frame = panel::settingsOpen() && lakes::settingsFrame() ? lakes::settingsFrame() : pixels;
    char row[256 * 4 + 1];
    static constexpr char hex[] = "0123456789abcdef";
    puts("LAKES_FRAME 256 150");
    for (int y = 0; y < 150; y++) {
        for (int x = 0; x < 256; x++) {
            uint16_t p = frame[(y * 4) * 1024 + x * 4];
            for (int j = 0; j < 4; j++)
                row[x * 4 + j] = hex[(p >> (12 - 4 * j)) & 15];
        }
        row[1024] = 0;
        printf("LROW %d %s\n", y, row);
        if (y % 8 == 0)
            vTaskDelay(1);
    }
    puts("LAKES_FRAME_END");
}
void input(char c) {
    static std::string line;
    if (c == '\r')
        return;
    if (c != '\n') {
        if (line.size() < 256)
            line += c;
        return;
    }
    if (line.rfind("W1\t", 0) == 0)
        wifi_save(line);
    else if (line == "SHOT")
        capture();
    else if (line == "STATUS")
        report();
    else if (line == "HOLD" || line == "GRAY") {
        held = true;
        if (line == "GRAY") {
            pixels = crowpanel_back_buffer();
            std::fill_n(pixels, 1024 * 600, uint16_t(0x8410));
            crowpanel_present();
            ++flips;
        }
        crowpanel_prime_other_buffer();
        auto checksum = [](const uint16_t *buf) {
            return esp_rom_crc32_le(0, (const uint8_t *)buf, 1024 * 600 * 2);
        };
        printf("LAKES_HOLD %08lx %08lx\n", (unsigned long)checksum(pixels),
               (unsigned long)checksum(crowpanel_back_buffer()));
    } else if (line == "RUN") {
        held = false;
        lakes::requestRedraw();
        puts("LAKES_RUN");
    } else if (line.rfind("TAP ", 0) == 0) {
        int x, y;
        if (sscanf(line.c_str() + 4, "%d %d", &x, &y) == 2 && unsigned(x) < 1024 && unsigned(y) < 600) {
            if (!held && panel::settingsOpen()) {
                lakes::settingsPointer(x, y, true);
                lakes::settingsPointer(x, y, false);
            } else if (!held)
                lakes::gesture(x, y, 0, 0, now());
            puts("LAKES_TAP_OK");
        }
    }
    line.clear();
}
} // namespace
extern "C" void app_main() {
    crowpanel_display_init();
    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0, 8192, 0, 0, nullptr, 0));
    lakes::init();
    lakes::initFeedQueue();
    draw();
    crowpanel_prime_other_buffer();
    panel::loadPreferences();
    panel::startBacklight();
    panel::hornInit();
    ESP_LOGI("lakes", "Both DSI buffers primed, portrait map drawn in %u ms; %d recorded vehicles",
             unsigned(drawMs), lakes::visibleCount());
    wifi_start(public_feed_start);
    for (;;) {
        char bytes[150];
        int n = uart_read_bytes(UART_NUM_0, bytes, sizeof(bytes), pdMS_TO_TICKS(18));
        for (int i = 0; i < n; i++)
            input(bytes[i]);
        touch();
        lakes::consumeFeed(now());
        if (!held && panel::settingsOpen()) lakes::updatePanelSettings();
        else if (!held && lakes::needsRender(now()))
            draw();
    }
}
