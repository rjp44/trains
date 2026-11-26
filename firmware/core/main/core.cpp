#include "core.h"
#include "package.h"
#include "display.h"
#include "map.h"
#include "panel.h"
#include "settings_display.h"
#include "settings_ui.h"
#include "preferences.h"
#include "wifi.h"
#include "source.h"
#include "driver/uart.h"
#include "esp_heap_caps.h"
#include "esp_system.h"
#include "esp_ota_ops.h"
#include "esp_rom_crc.h"
#include "esp_timer.h"
#include <cstring>
#include <mutex>
void lakes_feed_start();
void hemel_feed_start();
namespace {
std::recursive_mutex displayMutex;
bool isLakes, isHemel;
int replaySelection = -1;
uint32_t replayStart, holdStart;
bool held;
void chooseRecording(lv_event_t *event) {
    static const char *captions[] = {"Use replay", "Sector replay", "Hemel replay", "Watford replay"};
    replaySelection = (replaySelection + 2) % 4 - 1;
    setManualReplay(replaySelection >= 0);
    if (replaySelection >= 0) {
        hemel::replay(static_cast<hemel::Sample>(replaySelection));
        hemel::view(static_cast<hemel::View>(replaySelection));
        replayStart = esp_timer_get_time() / 1000;
    }
    lv_label_set_text((lv_obj_t *)lv_event_get_user_data(event), captions[replaySelection + 1]);
}
uint32_t now() { return esp_timer_get_time() / 1000; }
void drawLakes() {
    lakes::render(crowpanel_back_buffer(), now());
    crowpanel_present();
}
void settings() {
    panel::openSettings(nullptr, isHemel ? "Stopping at Hemel only" : "Stopping trains only");
}
void pointer(int x, int y, bool pressed) {
    static int startX, startY;
    static bool down = false, settingsTouch = false;
    if (isHemel) {
        hemel::pointer(x, y, pressed);
        return;
    }
    if (panel::settingsOpen() || settingsTouch || !isLakes) {
        lakes::settingsPointer(x, y, pressed);
        settingsTouch = pressed;
        down = false;
        return;
    }
    if (pressed && !down) {
        startX = x;
        startY = y;
    }
    if (!pressed && down)
        lakes::gesture(x, y, x - startX, y - startY, now());
    down = pressed;
}
void capture() {
    const auto *frame = crowpanel_front_buffer();
    const char hex[] = "0123456789abcdef";
    char row[1025];
    puts("LAKES_FRAME 256 150");
    for (int y = 0; y < 150; y++) {
        for (int x = 0; x < 256; x++) {
            uint16_t pixel = frame[(y * 4) * 1024 + x * 4];
            for (int k = 0; k < 4; k++)
                row[x * 4 + k] = hex[(pixel >> (12 - 4 * k)) & 15];
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
    if (line == "STATUS") {
        printf("DISPLAY slot=%s refresh=%lu held=%d sound=%u volume=%u brightness=%u orientation=%s "
               "settings=%d\n",
               esp_ota_get_running_partition()->label, (unsigned long)crowpanel_refresh_count(), held,
               unsigned(panel::sound()), panel::volume(), panel::brightness(),
               isLakes && lakes::portraitView() ? "portrait" : "landscape", panel::settingsOpen());
        const auto s = transport::status();
        printf("TRANSPORT_STATUS wifi=%u %s  %s\n", unsigned(wifi_link_state() & 1), s.c_str(),
               isLakes   ? lakes::status().c_str()
               : isHemel ? (hemel::isLive() ? "live" : "replay")
                         : "recovery");
    } else if (line == "SHOT")
        capture();
    else if (line == "HOLD") {
        held = true;
        holdStart = now();
        crowpanel_prime_other_buffer();
        auto crc = [](const uint16_t *p) {
            return (unsigned long)esp_rom_crc32_le(0, (const uint8_t *)p, 1024 * 600 * 2);
        };
        printf("LAKES_HOLD %08lx %08lx\n", crc(crowpanel_front_buffer()), crc(crowpanel_back_buffer()));
    } else if (line == "RUN") {
        held = false;
        lakes::requestRedraw();
    } else if (line.rfind("APP ", 0) == 0)
        transport::action(line.c_str() + 4);
    else if (line == "SETTINGS") {
        if (isLakes)
            lakes::openPanelSettings(lakes::portraitView());
        else
            settings();
    } else if (line.rfind("TAP ", 0) == 0) {
        int x, y;
        if (sscanf(line.c_str() + 4, "%d %d", &x, &y) == 2 && unsigned(x) < 1024 && unsigned(y) < 600) {
            pointer(x, y, true);
            pointer(x, y, false);
        }
    } else if (line.rfind("W1\t", 0) == 0)
        wifi_save(line);
    line.clear();
}
} // namespace
namespace transport {
void lockDisplay() { displayMutex.lock(); }
void unlockDisplay() { displayMutex.unlock(); }
} // namespace transport
extern "C" void app_main() {
    crowpanel_display_init();
    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0, 8192, 0, 0, nullptr, 0));
    panel::loadPreferences();
    cJSON_Hooks hooks{
        [](size_t n) -> void * { return heap_caps_malloc(n, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT); }, free};
    cJSON_InitHooks(&hooks);
    transport::storageInit();
    const bool mounted = transport::mount();
    isHemel = mounted && !strcmp(transport::activeApp(), "hemel");
    isLakes = mounted && !strcmp(transport::activeApp(), "lakes");
    auto display = lakes::coreDisplay(!isLakes);
    if (!display) {
        transport::failedBoot();
        esp_restart();
    }
    panel::setAppsPage(transport::appsPage);
    if (isLakes) {
        lakes::init();
        lakes::initFeedQueue();
        drawLakes();
    } else {
        if (isHemel) {
            if (!hemel::attach(display)) {
                transport::failedBoot();
                esp_restart();
            }
            hemel::replay(static_cast<hemel::Sample>(transport::defaultRecording));
            hemel::restoreView(static_cast<hemel::View>(transport::defaultView));
            hemel::seek(5000, now());
            auto replay = lv_button_create(lv_screen_active());
            lv_obj_set_pos(replay, 3, 105);
            lv_obj_set_size(replay, 100, 32);
            auto text = lv_label_create(replay);
            lv_label_set_text(text, "Use replay");
            lv_obj_center(text);
            lv_obj_add_event_cb(replay, chooseRecording, LV_EVENT_CLICKED, text);
            hemel::setArrivalHandler([](hemel::Direction d, bool stops) {
                panel::trainHorn(d == hemel::Direction::Down, stops);
            });
        } else {
            auto l = lv_label_create(lv_screen_active());
            lv_label_set_text(l, "Transport Display\nOpen Settings > Apps to install Hemel or Lakes.");
            lv_obj_center(l);
        }
        auto b = lv_button_create(lv_screen_active());
        lv_obj_set_pos(b, 3, 70);
        lv_obj_set_size(b, 88, 32);
        auto l = lv_label_create(b);
        lv_label_set_text(l, "Settings");
        lv_obj_center(l);
        lv_obj_add_event_cb(b, [](lv_event_t *) { settings(); }, LV_EVENT_CLICKED, nullptr);
        lv_refr_now(display);
    }
    crowpanel_prime_other_buffer();
    panel::startBacklight();
    panel::hornInit();
    transport::validated();
    printf("TRANSPORT_READY %s v%d\n", transport::activeApp(), TRANSPORT_VERSION);
    wifi_start([] {
        if (isLakes)
            lakes_feed_start();
        else if (isHemel)
            hemel_feed_start();
    });
    replayStart = now() - 5000;
    for (;;) {
        char data[160];
        int n = uart_read_bytes(UART_NUM_0, data, sizeof data, pdMS_TO_TICKS(18));
        std::lock_guard<std::recursive_mutex> lock(displayMutex);
        for (int j = 0; j < n; j++)
            input(data[j]);
        if (held && now() - holdStart < 10000)
            continue;
        held = false;
        static uint16_t x = 0, y = 0;
        bool pressed;
        if (crowpanel_touch(&x, &y, &pressed))
            pointer(x, y, pressed);
        if (isLakes)
            lakes::consumeFeed(now());
        if (isHemel) {
            if (hemel::isLive())
                hemel::updateLive(now());
            else
                hemel::seek((now() - replayStart) % (hemel::duration() + 1), now());
        }
        transport::pollApps();
        if (!isLakes || panel::settingsOpen())
            lakes::updatePanelSettings();
        else if (lakes::needsRender(now()))
            drawLakes();
    }
}
