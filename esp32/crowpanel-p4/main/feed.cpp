#include "wifi.h"
#include "source.h"
#include "feed_vm.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif_sntp.h"
#ifdef TRANSPORT_CORE
#include "core.h"
#define lvgl_port_lock(timeout) transport::lockDisplay()
#define lvgl_port_unlock() transport::unlockDisplay()
#else
#include "esp_lvgl_port.h"
#endif
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include <atomic>
#include <memory>
#include <new>

// The Wi-Fi side never owns the serial port. All JS, including promise
// continuations, runs on one task. Only complete messages cross task boundaries.
namespace {
constexpr size_t maxBody = 512 * 1024;
struct SocketEvent { bool opened; std::string *message; };
struct Socket {
    QueueHandle_t events;
    std::atomic<bool> failed{false};
    std::string partial;
    bool collecting = false;
    size_t frameStart = 0;
    esp_websocket_client_handle_t client = nullptr;

    void close() {
        failed = true;
        if (client) {
            esp_websocket_client_stop(client);
            esp_websocket_client_destroy(client);
            client = nullptr;
        }
        SocketEvent event;
        while (xQueueReceive(events, &event, 0)) delete event.message;
        partial.clear();
        collecting = false;
        failed = false;
    }
    void post(bool opened, std::string *body = nullptr) {
        SocketEvent event{opened, body};
        // Let TCP absorb a short burst while the feed task parses a timetable.
        if (!xQueueSend(events, &event, pdMS_TO_TICKS(1000))) {
            delete body;
            ESP_LOGW("feed", "Relay receive queue full");
            failed = true;
        }
    }
};
void wsEvent(void *arg, esp_event_base_t, int32_t id, void *payload) {
    auto &s = *static_cast<Socket *>(arg);
    if (s.failed) return;
    if (id == WEBSOCKET_EVENT_CONNECTED) { s.post(true); return; }
    if (id == WEBSOCKET_EVENT_ERROR || id == WEBSOCKET_EVENT_DISCONNECTED || id == WEBSOCKET_EVENT_CLOSED) {
        ESP_LOGW("feed", "Relay transport ended (event %ld)", long(id));
        s.failed = true;
        return;
    }
    if (id != WEBSOCKET_EVENT_DATA) return;
    auto &e = *static_cast<esp_websocket_event_data_t *>(payload);
    if (e.op_code >= 8) return;
    if (e.payload_offset == 0) {
        if (e.op_code == 1 && !s.collecting) { s.collecting = true; s.partial.clear(); }
        else if (e.op_code != 0 || !s.collecting) {
            ESP_LOGW("feed", "Unexpected relay frame (opcode %d)", int(e.op_code));
            s.failed = true;
            return;
        }
        s.frameStart = s.partial.size();
    }
    if (!s.collecting || e.payload_offset < 0 || e.data_len < 0 || e.payload_len < 0 ||
        size_t(e.payload_offset) != s.partial.size() - s.frameStart ||
        size_t(e.payload_len) > maxBody - s.frameStart ||
        size_t(e.data_len) + size_t(e.payload_offset) > size_t(e.payload_len)) {
        ESP_LOGW("feed", "Invalid relay frame (length %d, offset %d)", e.payload_len, e.payload_offset);
        s.failed = true;
        return;
    }
    if (e.data_len) s.partial.append(e.data_ptr, e.data_len);
    if (e.fin && e.payload_offset + e.data_len == e.payload_len) {
        s.collecting = false;
        auto body = new (std::nothrow) std::string(std::move(s.partial));
        if (body) s.post(false, body);
        else s.failed = true;
    }
}

void open(Socket &s) {
    esp_websocket_client_config_t cfg = {};
    cfg.uri = "wss://ws.signalmaps.co.uk/new";
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
    cfg.disable_auto_reconnect = true;
    cfg.buffer_size = 8192;
    cfg.network_timeout_ms = 8000;
    s.client = esp_websocket_client_init(&cfg);
    if (!s.client || esp_websocket_register_events(s.client, WEBSOCKET_EVENT_ANY, wsEvent, &s) != ESP_OK ||
        esp_websocket_client_start(s.client) != ESP_OK) s.failed = true;
}

struct Lookup { unsigned session; std::string data; };
QueueHandle_t fetches, results;
void fetchTask(void *) {
    char buf[2048];
    for (;;) {
        Lookup *job;
        xQueueReceive(fetches, &job, portMAX_DELAY);
        std::string url = std::move(job->data);
        job->data.clear();
        esp_http_client_config_t cfg = {};
        cfg.url = url.c_str();
        cfg.crt_bundle_attach = esp_crt_bundle_attach;
        cfg.timeout_ms = 6500;
        cfg.disable_auto_redirect = true;
        auto client = esp_http_client_init(&cfg);
        bool ok = false;
        if (client && esp_http_client_open(client, 0) == ESP_OK) {
            auto length = esp_http_client_fetch_headers(client);
            if (length >= 0 && size_t(length) <= maxBody && esp_http_client_get_status_code(client) == 200) {
                const int64_t end = esp_timer_get_time() + 8000000;
                int got = -1;
                while (esp_timer_get_time() < end && (got = esp_http_client_read(client, buf, sizeof(buf))) > 0) {
                    if (job->data.size() + got > maxBody) break;
                    job->data.append(buf, got);
                }
                ok = got == 0 && esp_http_client_is_complete_data_received(client);
            }
        }
        if (client) esp_http_client_cleanup(client);
        if (!ok) job->data.clear();
        xQueueSend(results, &job, portMAX_DELAY);
    }
}
void run(FeedVM &vm, Socket &s, unsigned session) {
    int current = 0;
    uint32_t drawn = 0, link = wifi_link_state();
    std::string previousStatus;
    uint32_t lastReport = 0;
    while (vm.ok) {
        const uint32_t state = wifi_link_state();
        if (state != link) {
            vm.call("closed");
            s.close();
            current = 0;
            link = state;
        }
        int wanted = vm.tick();
        if (!(state & 1)) wanted = 0;
        if (wanted != current) {
            s.close();
            current = wanted;
            if (current) open(s);
        }
        if (s.failed) { vm.call("closed"); s.close(); current = 0; }
        SocketEvent event;
        for (int i = 0; i < 8 && current && !s.failed && xQueueReceive(s.events, &event, 0); ++i) {
            std::unique_ptr<std::string> body(event.message);
            if (event.opened) {
                ESP_LOGI("feed", "Public relay connected");
                const auto opts = vm.call("opened");
                if (esp_websocket_client_send_text(s.client, opts.data(), opts.size(), pdMS_TO_TICKS(1500)) != int(opts.size()))
                    s.failed = true;
            } else vm.call("message", body.get());
            // The reducer closes this generation immediately after a gap or stale message.
            if (vm.tick() != current) break;
        }
        Lookup *result;
        if (xQueueReceive(results, &result, 0)) {
            std::unique_ptr<Lookup> job(result);
            if (job->session == session) vm.call("response", &job->data);
        }
        if (s.failed || wifi_link_state() != link) continue;
        const uint32_t now = esp_timer_get_time()/1000;
        if (now - drawn >= 1500) {
            drawn = now;
            lvgl_port_lock(0);
            bool full = wifi_needs_snapshot();
            lvgl_port_unlock();
            const auto packet = vm.call("packet", nullptr, full);
            const auto status = vm.call("status");
            if (status != previousStatus) {
                ESP_LOGI("feed", "Panel feed %s", status.c_str());
                previousStatus = status;
            }
            if (!packet.empty() && now - lastReport >= 30000) {
                lastReport = now;
                ESP_LOGI("feed", "Live card check: %s [%s]", status.c_str(), vm.call("cardHeads").c_str());
            }
            if (!packet.empty()) {
                lvgl_port_lock(0);
                if (full || !wifi_needs_snapshot()) wifi_packet(packet.data(), packet.size(), esp_timer_get_time()/1000);
                lvgl_port_unlock();
            }
            auto url = vm.call("request");
            if (!url.empty()) {
                auto job = new (std::nothrow) Lookup{session, std::move(url)};
                if (!job || !xQueueSend(fetches, &job, 0)) {
                    delete job;
                    const std::string empty;
                    vm.call("response", &empty);
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(30));
    }
    s.close();
}
void feedTask(void *) {
    // TLS certificate validity and the relay's 45-second freshness check both need UTC.
    ESP_LOGI("feed", "Waiting for network UTC");
    while (esp_netif_sntp_sync_wait(pdMS_TO_TICKS(15000)) != ESP_OK) vTaskDelay(pdMS_TO_TICKS(1000));
    Socket s;
    s.events = xQueueCreate(32, sizeof(SocketEvent));
    fetches = xQueueCreate(1, sizeof(Lookup *));
    results = xQueueCreate(1, sizeof(Lookup *));
    if (s.events && fetches && results && xTaskCreate(fetchTask, "rail-https", 8192, nullptr, 3, nullptr) == pdPASS) {
        for (unsigned session = 1;; ++session) {
            FeedVM vm;
            if (vm.init()) run(vm, s, session);
            vTaskDelay(pdMS_TO_TICKS(5000));
        }
    }
    ESP_LOGW("feed", "Feed task allocation failed");
    vTaskDeleteWithCaps(nullptr);
}
}

void public_feed_start() {
    if (xTaskCreateWithCaps(feedTask, "rail-feed", 96 * 1024, nullptr, 3, nullptr, MALLOC_CAP_SPIRAM) != pdPASS)
        ESP_LOGW("feed", "Feed stack allocation failed");
}
