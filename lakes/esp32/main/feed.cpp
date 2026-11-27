#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "map.h"
#include "preferences.h"
#include "rail_events.h"
#include "package.h"
#include "wifi.h"
#include <cmath>
#include <cctype>
#include <ctime>
#include <memory>

namespace {
QueueHandle_t updates;
const cJSON *field(const cJSON *o, const char *k) { return cJSON_GetObjectItemCaseSensitive(o, k); }
const char *str(const cJSON *o, const char *k) {
    const auto *v = field(o, k);
    return cJSON_IsString(v) ? v->valuestring : "";
}
double num(const cJSON *v, double fallback = -1) {
    return cJSON_IsNumber(v) && std::isfinite(v->valuedouble) ? v->valuedouble : fallback;
}
bool readBody(std::string &body, const char *url = transport::vehicleFeed.c_str(),
              int maxBytes = 131072) {
    esp_http_client_config_t cfg = {};
    cfg.url = url;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
    cfg.timeout_ms = 12000;
    cfg.disable_auto_redirect = true;
    cfg.buffer_size = 4096;
    auto client = esp_http_client_init(&cfg);
    if (!client)
        return false;
    bool ok = false;
    if (esp_http_client_open(client, 0) == ESP_OK) {
        auto length = esp_http_client_fetch_headers(client);
        auto status = esp_http_client_get_status_code(client);
        if (status == 200 && length <= maxBytes) {
            char block[1536];
            int n;
            while ((n = esp_http_client_read(client, block, sizeof(block))) > 0 &&
                   body.size() + n <= size_t(maxBytes))
                body.append(block, n);
            ok = n == 0 && esp_http_client_is_complete_data_received(client) && !body.empty();
        }
        if (!ok)
            ESP_LOGW("lakes", "HTTPS %d, received %u bytes", status, unsigned(body.size()));
        esp_http_client_close(client);
    }
    esp_http_client_cleanup(client);
    return ok;
}
// Older deployed Lakes responses omit lastStop. Only consult the upstream map
// for a new report in stops-only mode, and require the very same train and report.
void fillMissingStops(const lakes::Snapshot &previous, lakes::Snapshot &current) {
    if (panel::sound() != panel::Sound::Stops) return;
    std::vector<lakes::Vehicle *> missing;
    const int64_t now = int64_t(time(nullptr)) * 1000;
    for (auto &v : current.vehicles)
        if (v.lastStop < 0 && lakes::newRailReport(previous, current, v, now)) missing.push_back(&v);
    if (missing.empty()) return;
    std::string raw;
    if (!readBody(raw, "https://api.railinfo.uk/map/trains", 2 * 1024 * 1024)) return;
    auto name = raw.find("\"trains\"");
    if (name == raw.npos) return;
    auto array = raw.find('[', name + 8);
    if (array == raw.npos) return;
    const char *pos = raw.data() + array + 1, *end = raw.data() + raw.size();
    // Parse one vehicle at a time to keep the nationwide DOM out of RAM.
    while (pos < end && !missing.empty()) {
        while (pos < end && (*pos == ',' || std::isspace(static_cast<unsigned char>(*pos)))) ++pos;
        if (pos == end || *pos != '{') break;
        const char *next = nullptr;
        std::unique_ptr<cJSON, decltype(&cJSON_Delete)> item(
            cJSON_ParseWithLengthOpts(pos, end-pos, &next, false), cJSON_Delete);
        if (!item || !next || next <= pos) break;
        pos = next;
        auto last = field(item.get(), "last");
        auto stop = field(last, "stop");
        if (!cJSON_IsBool(stop)) continue;
        auto found = std::find_if(missing.begin(), missing.end(), [&](auto *v) {
            return v->id.size() > 5 && v->id.compare(5, std::string::npos, str(item.get(),"id")) == 0 &&
                   v->lastCode == str(last,"crs") && v->last == str(last,"name") &&
                   v->lastTime == str(last,"time");
        });
        if (found != missing.end()) { (*found)->lastStop = cJSON_IsTrue(stop); missing.erase(found); }
    }
}
void worker(void *) {
    lakes::Snapshot previous;
    ESP_LOGI("lakes", "C6 Wi-Fi associated; waiting for network time");
    for (;;) {
        if (!(wifi_link_state() & 1) || time(nullptr) < 1700000000) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        std::string body;
        lakes::Snapshot snapshot;
        snapshot.link = wifi_link_state();
        const auto generation = snapshot.link;
        bool ok = readBody(body) && lakes::decode(body.c_str(), snapshot);
        snapshot.link = generation;
        if (ok) fillMissingStops(previous, snapshot);
        ok = ok && generation == wifi_link_state();
        previous.vehicles.clear();
        previous.link = generation;
        previous.railOk = ok && snapshot.railOk;
        if (previous.railOk)
            for (const auto &v : snapshot.vehicles) if (v.route >= 8) previous.vehicles.push_back(v);
        unsigned bus = 0, rail = 0;
        for (auto &v : snapshot.vehicles)
            (v.route >= 8 ? rail : bus)++;
        if (ok)
            ESP_LOGI("lakes", "HTTPS snapshot bus=%u rail=%u, sources %d/%d, timestamp=%lld", bus, rail,
                     snapshot.busOk, snapshot.railOk, (long long)snapshot.time);
        else
            ESP_LOGW("lakes", "Live fetch failed; retrying");
        auto *message = ok ? new lakes::Snapshot(std::move(snapshot)) : nullptr;
        if (xQueueSend(updates, &message, 0) != pdTRUE)
            delete message;
        vTaskDelay(pdMS_TO_TICKS(ok ? 30000 : 12000));
    }
}
} // namespace
void public_feed_start() { xTaskCreate(worker, "lakes_https", 12288, nullptr, 4, nullptr); }
namespace lakes {
void initFeedQueue() {
    updates = xQueueCreate(2, sizeof(Snapshot *));
    ESP_ERROR_CHECK(updates ? ESP_OK : ESP_ERR_NO_MEM);
}
void consumeFeed(uint32_t now) {
    Snapshot *message;
    while (xQueueReceive(updates, &message, 0) == pdTRUE) {
        if (message) {
            receive(std::move(*message), now);
            delete message;
        } else
            failed();
    }
}
bool decode(const char *body, Snapshot &out) {
    std::unique_ptr<cJSON, decltype(&cJSON_Delete)> doc(cJSON_Parse(body), &cJSON_Delete);
    if (!doc)
        return false;
    Snapshot result;
    result.time = num(field(doc.get(), "time"));
    if (result.time <= 0)
        return false;
    for (const char *key : {"bus", "rail"}) {
        auto feed = field(doc.get(), key), rows = field(feed, "vehicles");
        if (!cJSON_IsArray(rows) || !cJSON_IsBool(field(feed, "ok")))
            return false;
        bool rail = key[0] == 'r';
        (rail ? result.railOk : result.busOk) = cJSON_IsTrue(field(feed, "ok"));
        const cJSON *row;
        cJSON_ArrayForEach(row, rows) {
            Vehicle v;
            v.route = routeIndex(str(row, "route"));
            v.id = str(row, "id");
            v.time = num(field(row, "time"));
            auto p = field(row, "point");
            double lon = num(cJSON_GetArrayItem(p, 0), 999), lat = num(cJSON_GetArrayItem(p, 1), 999);
            if (v.route < 0 || (v.route >= 8) != rail || v.id.empty() || v.time <= 0 || lon < -4 ||
                lon > -2 || lat < 53.9 || lat > 55)
                continue;
            project(lon, lat, v.x, v.y);
            v.label = str(row, "label");
            v.agency = str(row, "agency");
            v.destination = str(row, "destination");
            v.origin = str(row, "origin");
            v.terminus = str(row, "terminus");
            v.departure = str(row, "departure");
            v.serviceDate = str(row, "serviceDate");
            v.bearing = num(field(row, "bearing"));
            v.direction = num(field(row, "direction"), 0);
            v.last = str(row, "last");
            v.next = str(row, "next");
            v.lastCode = str(row, "lastCode");
            v.nextCode = str(row, "nextCode");
            v.lastTime = str(row, "lastTime");
            auto stop = field(row, "lastStop");
            if (cJSON_IsBool(stop)) v.lastStop = cJSON_IsTrue(stop);
            v.nextTime = str(row, "nextTime");
            result.vehicles.push_back(std::move(v));
        }
    }
    out = std::move(result);
    return true;
}
} // namespace lakes
