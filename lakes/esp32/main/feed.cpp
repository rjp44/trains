#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "map.h"
#include "wifi.h"
#include <cmath>
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
bool readBody(std::string &body) {
    esp_http_client_config_t cfg = {};
    cfg.url = "https://lakes-transit.netlify.app/api/vehicles";
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
        if (status == 200 && length <= 131072) {
            char block[1536];
            int n;
            while ((n = esp_http_client_read(client, block, sizeof(block))) > 0 &&
                   body.size() + n <= 131072)
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
void worker(void *) {
    ESP_LOGI("lakes", "C6 Wi-Fi associated; waiting for network time");
    for (;;) {
        if (!(wifi_link_state() & 1) || time(nullptr) < 1700000000) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        std::string body;
        lakes::Snapshot snapshot;
        bool ok = readBody(body) && lakes::decode(body.c_str(), snapshot);
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
            v.nextTime = str(row, "nextTime");
            result.vehicles.push_back(std::move(v));
        }
    }
    out = std::move(result);
    return true;
}
} // namespace lakes
