#include "core.h"
#include "version.h"
#include "appearance.h"
#include "toolbar.h"
#include "gestures.h"
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
uint32_t now() { return esp_timer_get_time() / 1000; }
void hemelOptions(lv_obj_t *parent) {
    auto row = panel::optionRow(parent, "View");
    for (unsigned i = 0; i < 3; ++i)
        panel::option(row, hemel::viewName(static_cast<hemel::View>(i)), [](lv_event_t *e) {
            hemel::view(static_cast<hemel::View>(reinterpret_cast<uintptr_t>(lv_event_get_user_data(e))));
            panel::refreshAppPage();
        }, i, i == static_cast<unsigned>(hemel::currentView()));
    row = panel::optionRow(parent, "Data source");
    constexpr const char *sources[] = {"Live", "Sector replay", "Hemel replay", "Watford replay"};
    for (int i = 0; i < (hemel::regionalLayout() ? 2 : 4); ++i) {
        panel::option(row, hemel::regionalLayout() && i == 1 ? "Recorded movements" : sources[i], [](lv_event_t *e) {
            int selected = int(reinterpret_cast<uintptr_t>(lv_event_get_user_data(e))) - 1;
            if (selected == replaySelection) return;
            replaySelection = selected;
            setManualReplay(selected >= 0);
            if (selected >= 0) {
                hemel::replay(static_cast<hemel::Sample>(selected));
                if (!hemel::regionalLayout()) hemel::view(static_cast<hemel::View>(selected));
                replayStart = now();
            }
            panel::refreshAppPage();
        }, i, i == replaySelection + 1);
    }
}
void drawLakes() {
    lakes::render(crowpanel_back_buffer(), now());
    crowpanel_present();
}
void settings() {
    if (isLakes) lakes::openPanelSettings(lakes::portraitView());
    else panel::openSettings(nullptr, isHemel && !hemel::regionalLayout() ? "Stopping at Hemel only" : "Stopping trains only");
}
void contacts(const TouchFrame &frame) {
    using namespace transport;
    static Gesture gesture;
    static Point previousCentre, uiPoint, scrollPoint;
    static float previousSpan;
    static bool eligible, pinched, uiMulti, scrollingCard;
    if (panel::settingsOpen() || (!isLakes && !isHemel) || uiMulti) {
        if (frame.count >= 2 && !uiMulti) {
            uiMulti = true;
            for (auto *dev = lv_indev_get_next(nullptr); dev; dev = lv_indev_get_next(dev))
                if (lv_indev_get_type(dev) == LV_INDEV_TYPE_POINTER) lv_indev_wait_release(dev);
        }
        if (frame.count == 1 && !uiMulti) uiPoint = {frame.points[0].x, frame.points[0].y};
        if (frame.count == 0 || (frame.count == 1 && !uiMulti)) {
            if (isHemel) hemel::pointer(uiPoint.x, uiPoint.y, frame.count != 0);
            else lakes::settingsPointer(uiPoint.x, uiPoint.y, frame.count != 0);
        }
        if (!frame.count) uiMulti = false;
        return;
    }
    bool portrait = isLakes && lakes::portraitView();
    auto logicalY = [&](Point p) { return portrait ? 1023 - p.x : p.y; };
    auto button = [&](Point p) {
        return toolbarButton(portrait ? p.y : p.x, logicalY(p), portrait ? 600 : 1024);
    };
    switch (gesture.sample(frame)) {
    case ContactEvent::PinchStart:
        scrollingCard = false;
        previousSpan = gesture.span;
        previousCentre = gesture.centre;
        eligible = logicalY({frame.points[0].x, frame.points[0].y}) >= toolbarHeight &&
                   logicalY({frame.points[1].x, frame.points[1].y}) >= toolbarHeight;
        pinched = false;
        break;
    case ContactEvent::PinchMove: {
        if (!eligible || gesture.span < 1) break;
        if (previousSpan < 1) {
            previousSpan = gesture.span;
            previousCentre = gesture.centre;
            break;
        }
        float ratio = gesture.span / previousSpan;
        if (!pinched && !pinchThreshold(previousSpan, gesture.span, isHemel)) break;
        if (isHemel) {
            if (!pinched) hemel::pinchView(ratio > 1, previousCentre.x);
        } else lakes::pinch(ratio, previousCentre.x, previousCentre.y, gesture.centre.x, gesture.centre.y);
        previousSpan = gesture.span;
        previousCentre = gesture.centre;
        pinched = true;
        break;
    }
    case ContactEvent::PinchEnd:
        if (isLakes && pinched) lakes::finishPinch();
        break;
    case ContactEvent::SingleEnd: {
        if (scrollingCard) { scrollingCard = false; break; }
        Point start = gesture.start, end = gesture.last;
        if (logicalY(start) < toolbarHeight || logicalY(end) < toolbarHeight) {
            if (gesture.dragged || button(start) != button(end)) break;
            if (isLakes) lakes::dismissDetails(now());
            if (button(end) == ToolbarButton::Settings) settings();
            if (button(end) == ToolbarButton::Theme) {
                transport::toggleAppearance();
            }
        } else if (isLakes) {
            if (!gesture.dragged || std::abs(end.x - start.x) + std::abs(end.y - start.y) > 14)
                lakes::gesture(end.x, end.y, end.x - start.x, end.y - start.y, now());
        } else if (!gesture.dragged) {
            hemel::pointer(start.x, start.y, true);
            hemel::pointer(end.x, end.y, false);
        }
        break;
    }
    case ContactEvent::None:
        if (isLakes && frame.count == 1 && !gesture.multi && gesture.dragged) {
            int dy = logicalY(gesture.last) - logicalY(scrollingCard ? scrollPoint : gesture.start);
            scrollingCard = lakes::scrollDetails(portrait ? gesture.start.y : gesture.start.x, logicalY(gesture.start), dy);
            scrollPoint = gesture.last;
        }
        break;
    }
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
               "settings=%d touch_capacity=%u\n",
               esp_ota_get_running_partition()->label, (unsigned long)crowpanel_refresh_count(), held,
               unsigned(panel::sound()), panel::volume(), panel::brightness(),
               isLakes && lakes::portraitView() ? "portrait" : "landscape", panel::settingsOpen(), crowpanel_touch_capacity());
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
        settings();
    } else if (line.rfind("TAP ", 0) == 0) {
        int x, y;
        if (sscanf(line.c_str() + 4, "%d %d", &x, &y) == 2 && unsigned(x) < 1024 && unsigned(y) < 600) {
            TouchFrame tap{1, {{uint16_t(x), uint16_t(y)}, {}}};
            contacts(tap);
            contacts(TouchFrame{});
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
    isHemel = mounted && !strcmp(transport::activeAdapter(), "hemel-corridor/1");
    isLakes = mounted && !strcmp(transport::activeAdapter(), "lakes-map/1");
    auto display = lakes::coreDisplay(!isLakes, isHemel);
    if (!display) {
        transport::failedBoot();
        esp_restart();
    }
    if (isLakes) panel::setAppPage(lakes::drawOptions);
    if (isHemel) panel::setAppPage(hemelOptions);
    panel::setAppsPage(transport::appsPage);
    panel::setAboutPage(transport::aboutPage);
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
            hemel::setArrivalHandler([](hemel::Direction d, bool stops) {
                panel::trainHorn(d == hemel::Direction::Down, stops);
            });
        } else {
            auto l = lv_label_create(lv_screen_active());
            lv_label_set_text(l, "Transport Display\nOpen Settings > Downloads to download an app.");
            lv_obj_center(l);
            auto b = lv_button_create(lv_screen_active());
            lv_obj_align(b, LV_ALIGN_CENTER, 0, 55);
            lv_obj_set_style_bg_color(b, lv_color_hex(0x236b59), 0);
            auto caption = lv_label_create(b);
            lv_label_set_text(caption, "Settings");
            lv_obj_center(caption);
            lv_obj_add_event_cb(b, [](lv_event_t *) { settings(); }, LV_EVENT_CLICKED, nullptr);
        }
        lv_refr_now(display);
    }
    if (isLakes || isHemel) {
        setenv("TZ", "GMT0BST,M3.5.0/1,M10.5.0/2", 1);
        tzset();
        transport::initAppearance(isLakes);
        panel::setDisplayOptions(transport::appearanceOptions);
    }
    crowpanel_prime_other_buffer();
    panel::startBacklight();
    panel::hornInit();
    transport::validated();
    printf("TRANSPORT_READY %s %s\n", transport::activeApp(), transport::versionLabel(TRANSPORT_VERSION).c_str());
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
        TouchFrame frame{};
        if (crowpanel_touch(&frame)) contacts(frame);
        if (isLakes)
            lakes::consumeFeed(now());
        if (isHemel) {
            if (hemel::isLive())
                hemel::updateLive(now());
            else
                hemel::seek((now() - replayStart) % (hemel::duration() + 1), now());
        }
        transport::pollApps();
        transport::pollAppearance();
        if (!isLakes || panel::settingsOpen())
            lakes::updatePanelSettings();
        else if (lakes::needsRender(now()))
            drawLakes();
    }
}
