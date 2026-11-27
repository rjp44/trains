#include "appearance.h"
#include "package.h"
#include "sunlight.h"
#include "view-settings.h"
#include "panel.h"
#include "map.h"
#include "settings_ui.h"
#include "wifi.h"
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <atomic>
#include <cmath>
#include <cstdio>
#include <memory>
#include <string>
#include <type_traits>

namespace transport {
namespace {
bool enabled, lakesApp, automatic;
SunWeek week, received;
// Only the worker writes received. The display thread consumes it after completion.
enum class Fetch { Idle, Running, Ready, Failed };
std::atomic<Fetch> fetch{Fetch::Idle};
int64_t nextPoll, nextAttempt;
lv_obj_t *info;
std::string solarPlace, solarCoords, solarKey;
const char *cacheKey() { return solarKey.c_str(); }
bool light() { return lakesApp ? lakes::isLight() : hemel::isLight(); }
void apply(bool value) {
    if (light() == value) return;
    if (lakesApp) lakes::toggleTheme();
    else hemel::light(value);
}
bool getWeek(SunWeek &result) {
    std::string url = "https://api.open-meteo.com/v1/forecast?";
    url += solarCoords;
    url += "&timezone=Europe%2FLondon&daily=sunrise,sunset&timeformat=unixtime&forecast_days=7";
    esp_http_client_config_t config{};
    config.url = url.c_str();
    config.crt_bundle_attach = esp_crt_bundle_attach;
    config.timeout_ms = 10000;
    config.disable_auto_redirect = true;
    std::unique_ptr<std::remove_pointer_t<esp_http_client_handle_t>, decltype(&esp_http_client_cleanup)>
        client(esp_http_client_init(&config), esp_http_client_cleanup);
    if (!client || esp_http_client_open(client.get(), 0) != ESP_OK) return false;
    auto length = esp_http_client_fetch_headers(client.get());
    if (length > 4096 || esp_http_client_get_status_code(client.get()) != 200) return false;
    std::string body;
    char buf[512];
    int n;
    while ((n = esp_http_client_read(client.get(), buf, sizeof buf)) > 0) {
        if (body.size() + n > 4096) return false;
        body.append(buf, n);
    }
    if (n < 0 || !esp_http_client_is_complete_data_received(client.get())) return false;
    std::unique_ptr<cJSON, decltype(&cJSON_Delete)> doc(cJSON_Parse(body.c_str()), cJSON_Delete);
    auto daily = cJSON_GetObjectItemCaseSensitive(doc.get(), "daily");
    auto rises = cJSON_GetObjectItemCaseSensitive(daily, "sunrise");
    auto sets = cJSON_GetObjectItemCaseSensitive(daily, "sunset");
    if (!cJSON_IsArray(rises) || !cJSON_IsArray(sets) ||
        cJSON_GetArraySize(rises) != 7 || cJSON_GetArraySize(sets) != 7) return false;
    auto timestamp = [](const cJSON *list, int i) -> int64_t {
        const double t = cJSON_GetNumberValue(cJSON_GetArrayItem(list, i));
        return t >= 1700000000 && t < 4102444800 && t == std::floor(t) ? int64_t(t) : 0;
    };
    for (int i = 0; i < 7; ++i) result.days[i] = {timestamp(rises,i), timestamp(sets,i)};
    result.fetched = time(nullptr);
    return result.valid() && result.today(result.fetched);
}
void fetchTask(void *) {
    bool ok = getWeek(received);
    if (ok) saveView(cacheKey(), received);
    fetch.store(ok ? Fetch::Ready : Fetch::Failed);
    vTaskDelete(nullptr);
}
void describe(time_t now, const SunDay *day) {
    if (!info) return;
    std::string msg;
    if (automatic) {
        msg = solarPlace;
        if (day) {
            auto clock = [](time_t t) {
                tm local{}; localtime_r(&t, &local);
                char out[8]; strftime(out, sizeof out, "%H:%M", &local);
                return std::string(out);
            };
            msg += "   Sunrise " + clock(day->rise) + "   Sunset " + clock(day->set) + "   (UK time)";
        } else if (now < 1700000000) msg += "   Waiting for network time";
        else if (!(wifi_link_state() & 1)) msg += "   Waiting for Wi-Fi";
        else if (fetch == Fetch::Running) msg += "   Checking sunrise times...";
        else msg += "   Waiting for sunrise times";
        msg += "\nTimes from Open-Meteo (open-meteo.com)";
    }
    if (msg != lv_label_get_text(info)) lv_label_set_text(info, msg.c_str());
}
void setAuto(bool value) {
    if (automatic != value) {
        automatic = value;
        saveView("sun_auto", uint8_t(value));
    }
    nextPoll = 0;
}
} // namespace
void initAppearance(bool lakes) {
    enabled = true;
    lakesApp = lakes;
    solarPlace = lakes ? "Windermere" : "Hemel Hempstead";
    solarKey = lakes ? "sun_windermere" : "sun_hemel";
    solarCoords = lakes ? "latitude=54.38&longitude=-2.90" : "latitude=51.75&longitude=-0.47";
    auto site = cJSON_GetObjectItemCaseSensitive(tables, "solar");
    auto place = cJSON_GetStringValue(cJSON_GetArrayItem(site,0));
    double lat = cJSON_GetNumberValue(cJSON_GetArrayItem(site,1));
    double lon = cJSON_GetNumberValue(cJSON_GetArrayItem(site,2));
    if (place && std::abs(lat)<=90 && std::abs(lon)<=180) {
        solarPlace = place;
        solarCoords = "latitude="+std::to_string(lat)+"&longitude="+std::to_string(lon);
        solarKey = "sun"+std::to_string(unsigned((lat+90)*10000))+"_"+std::to_string(int(lon*100));
    }
    uint8_t mode{};
    automatic = loadView("sun_auto", mode) && mode == 1;
    if (!loadView(cacheKey(), week) || !week.valid()) week = {};
    pollAppearance();
}
void toggleAppearance() {
    setAuto(false);
    apply(!light());
}
void appearanceOptions(lv_obj_t *parent) {
    auto row = panel::optionRow(parent, "Map appearance");
    const char *names[] = {"Light", "Dark", "Sunrise / sunset"};
    const unsigned selected = automatic ? 2 : light() ? 0 : 1;
    for (unsigned i = 0; i < 3; ++i) {
        panel::option(row, names[i], [](lv_event_t *e) {
            auto choice = reinterpret_cast<uintptr_t>(lv_event_get_user_data(e));
            setAuto(choice == 2);
            if (choice != 2) apply(choice == 0);
            pollAppearance();
            panel::refreshDisplayPage();
        }, i, i == selected);
    }
    if (automatic) {
        info = lv_label_create(parent);
        lv_obj_set_width(info, lv_pct(100));
        lv_obj_add_event_cb(info, [](lv_event_t *) { info = nullptr; }, LV_EVENT_DELETE, nullptr);
        time_t now = time(nullptr);
        describe(now, week.today(now));
    }
}
void pollAppearance() {
    if (!enabled) return;
    const auto ticks = esp_timer_get_time();
    if (ticks < nextPoll) return;
    nextPoll = ticks + 1000000;
    const auto state = fetch.load();
    if (state == Fetch::Ready || state == Fetch::Failed) {
        if (state == Fetch::Ready) week = received;
        else nextAttempt = ticks + 300000000LL;
        fetch.store(Fetch::Idle);
    }
    if (!automatic) return;
    const time_t now = time(nullptr);
    auto day = week.today(now);
    if (day) apply(day->isDaylight(now));
    if (fetch == Fetch::Idle && ticks >= nextAttempt && now >= 1700000000 && (wifi_link_state() & 1) &&
        (!day || now < week.fetched || now - week.fetched >= 86400)) {
        fetch.store(Fetch::Running);
        if (xTaskCreate(fetchTask, "sun-times", 8192, nullptr, 3, nullptr) != pdPASS)
            fetch.store(Fetch::Failed);
    }
    describe(now, day);
}
} // namespace transport
