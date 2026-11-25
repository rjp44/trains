#include "wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs.h"
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <mutex>

namespace {
static_assert(CONFIG_ESP_HOSTED_SDIO_BUS_WIDTH == 4 && CONFIG_ESP_HOSTED_SDIO_SLOT == 1 &&
              CONFIG_ESP_HOSTED_SDIO_PIN_CLK == 18 && CONFIG_ESP_HOSTED_SDIO_PIN_CMD == 19 &&
              CONFIG_ESP_HOSTED_SDIO_PIN_D0 == 17 && CONFIG_ESP_HOSTED_SDIO_PIN_D1 == 16 &&
              CONFIG_ESP_HOSTED_SDIO_PIN_D2 == 15 && CONFIG_ESP_HOSTED_SDIO_PIN_D3 == 14 &&
              CONFIG_ESP_HOSTED_SDIO_GPIO_RESET_SLAVE == 32);
struct Credentials {
    uint8_t ssid[32], pass[64];
}; // Same blob as the original USB provisioner.
enum class Request { Scan, Join };
struct Command {
    Request kind;
    Credentials credentials;
};
QueueHandle_t commands;
EventGroupHandle_t events;
constexpr EventBits_t gotIP = BIT0, lostIP = BIT1;
std::atomic<uint32_t> linkState{0};
std::atomic<bool> unavailable{false};
std::mutex lock;
WifiStatus status;
void (*startFeed)();

void message(const char *s, bool busy = false) {
    std::lock_guard guard(lock);
    status.message = s;
    status.busy = busy;
    ++status.revision;
}
bool store(const Credentials &c) {
    nvs_handle_t n;
    if (nvs_open("hemel", NVS_READWRITE, &n) != ESP_OK)
        return false;
    bool ok = nvs_set_blob(n, "wifi", &c, sizeof(c)) == ESP_OK && nvs_commit(n) == ESP_OK;
    nvs_close(n);
    return ok;
}
Credentials savedNetwork() {
    Credentials c{};
    nvs_handle_t n;
    if (nvs_open("hemel", NVS_READONLY, &n) == ESP_OK) {
        size_t size = sizeof(c);
        if (nvs_get_blob(n, "wifi", &c, &size) != ESP_OK || size != sizeof(c))
            c = {};
        nvs_close(n);
    }
    return c;
}
void event(void *, esp_event_base_t base, int32_t id, void *) {
    bool up = base == IP_EVENT && id == IP_EVENT_STA_GOT_IP;
    linkState.store(((linkState.load() + 2u) & ~1u) | unsigned(up));
    xEventGroupSetBits(events, up ? gotIP : lostIP);
}
bool associatedWith(const Credentials &c) {
    wifi_ap_record_t ap{};
    return esp_wifi_sta_get_ap_info(&ap) == ESP_OK &&
           strncmp(reinterpret_cast<const char *>(ap.ssid), reinterpret_cast<const char *>(c.ssid),
                   sizeof(c.ssid)) == 0;
}
bool connect(const Credentials &c) {
    wifi_config_t cfg{};
    memcpy(cfg.sta.ssid, c.ssid, sizeof(c.ssid));
    memcpy(cfg.sta.password, c.pass, sizeof(c.pass));
    cfg.sta.threshold.authmode = c.pass[0] ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    cfg.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
    return esp_wifi_set_config(WIFI_IF_STA, &cfg) == ESP_OK && esp_wifi_connect() == ESP_OK;
}
void disconnect() {
    xEventGroupClearBits(events, gotIP | lostIP);
    if (esp_wifi_disconnect() == ESP_OK)
        xEventGroupWaitBits(events, lostIP, pdTRUE, pdFALSE, pdMS_TO_TICKS(1600));
    xEventGroupClearBits(events, gotIP | lostIP);
}
void scan() {
    wifi_scan_config_t cfg{};
    if (esp_wifi_scan_start(&cfg, true) != ESP_OK) {
        message("Scan failed. Tap Scan again.");
        return;
    }
    uint16_t count = 0;
    if (esp_wifi_scan_get_ap_num(&count) != ESP_OK) {
        esp_wifi_clear_ap_list();
        message("Could not read networks.");
        return;
    }
    std::vector<wifi_ap_record_t> records(count);
    if (count && esp_wifi_scan_get_ap_records(&count, records.data()) != ESP_OK) {
        esp_wifi_clear_ap_list();
        message("Could not read networks.");
        return;
    }
    std::vector<WifiNetwork> list;
    for (const auto &ap : records) {
        std::string name(reinterpret_cast<const char *>(ap.ssid),
                         strnlen(reinterpret_cast<const char *>(ap.ssid), 32));
        if (!name.empty() &&
            std::none_of(list.begin(), list.end(), [&](const auto &v) { return v.ssid == name; }))
            list.push_back({name, ap.authmode != WIFI_AUTH_OPEN});
    }
    std::lock_guard guard(lock);
    status.networks = std::move(list);
    status.message = status.networks.empty() ? "No networks found." : "Choose a network.";
    status.busy = false;
    ++status.revision;
}
void worker(void *) {
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    if (esp_netif_init() != ESP_OK || esp_event_loop_create_default() != ESP_OK ||
        !esp_netif_create_default_wifi_sta() ||
        esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, event, nullptr) != ESP_OK ||
        esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, event, nullptr) != ESP_OK ||
        esp_wifi_init(&init) != ESP_OK || esp_wifi_set_storage(WIFI_STORAGE_RAM) != ESP_OK ||
        esp_wifi_set_mode(WIFI_MODE_STA) != ESP_OK || esp_wifi_start() != ESP_OK) {
        unavailable = true;
        message("Wi-Fi hardware unavailable.");
        vTaskDelete(nullptr);
        return;
    }
    auto saved = savedNetwork();
    bool started = false, attempting = false, trial = false;
    Credentials candidate{};
    int64_t retry = 0, deadline = 0;
    message(saved.ssid[0] ? "Connecting to saved network..." : "Choose a Wi-Fi network.");
    for (;;) {
        const int64_t now = esp_timer_get_time() / 1000;
        EventBits_t bits = xEventGroupClearBits(events, gotIP | lostIP);
        if ((bits & gotIP) && (linkState.load() & 1)) {
            if (trial && !associatedWith(candidate))
                continue;
            attempting = false;
            if (trial && store(candidate)) {
                saved = candidate;
                message("Connected. Network saved.");
            } else if (trial) {
                message("Connected, but could not save network.");
            } else {
                // Keep an unsuccessful replacement visible after reconnecting to the saved network.
                std::lock_guard guard(lock);
                if (!status.busy && status.message.find("previous network") == std::string::npos) {
                    status.message = "Connected.";
                    ++status.revision;
                }
            }
            candidate = {};
            trial = false;
            if (!started) {
                esp_sntp_config_t clock = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
                if (esp_netif_sntp_init(&clock) == ESP_OK) {
                    startFeed();
                    started = true;
                }
            }
        } else if ((bits & lostIP) || (attempting && now >= deadline)) {
            if (attempting && !(bits & lostIP))
                disconnect();
            if (!attempting && !trial && saved.ssid[0])
                message("Connection lost. Reconnecting...");
            if (trial)
                message(saved.ssid[0] ? "Could not join. Restoring previous network."
                                      : "Could not join. Check the name and password.");
            candidate = {};
            trial = false;
            attempting = false;
            retry = now + 1500;
        }
        Command cmd{};
        if (xQueueReceive(commands, &cmd, pdMS_TO_TICKS(150))) {
            if (cmd.kind == Request::Scan) {
                if (attempting) {
                    disconnect();
                    attempting = false;
                }
                scan();
                retry = now + 1500;
            } else {
                disconnect();
                candidate = cmd.credentials;
                trial = attempting = true;
                deadline = now + 24000;
                if (!connect(candidate))
                    deadline = now;
            }
        } else if (!(linkState.load() & 1) && !attempting && saved.ssid[0] && now >= retry) {
            attempting = connect(saved);
            deadline = now + 24000;
            retry = now + 4000;
        }
    }
}
bool request(const Command &cmd, const char *msg) {
    std::lock_guard guard(lock);
    if (unavailable || !commands || status.busy || !xQueueSend(commands, &cmd, 0))
        return false;
    status.busy = true;
    status.message = msg;
    ++status.revision;
    return true;
}
bool decode(std::string_view value, uint8_t *out, size_t max) {
    if (value.size() % 2 || value.size() / 2 > max)
        return false;
    auto digit = [](char c) {
        return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
    };
    for (size_t i = 0; i < value.size(); i += 2) {
        int high = digit(value[i]), low = digit(value[i + 1]);
        if (high < 0 || low < 0 || (!high && !low))
            return false;
        out[i / 2] = high * 16 + low;
    }
    return true;
}
} // namespace
uint32_t wifi_link_state() { return linkState.load(); }
WifiStatus wifi_status() {
    std::lock_guard guard(lock);
    return status;
}
unsigned wifi_revision() {
    std::lock_guard guard(lock);
    return status.revision;
}
void wifi_start(void (*onFirstConnection)()) {
    startFeed = onFirstConnection;
    events = xEventGroupCreate();
    commands = xQueueCreate(1, sizeof(Command));
    if (!events || !commands || xTaskCreate(worker, "station", 8192, nullptr, 4, nullptr) != pdPASS) {
        unavailable = true;
        message("Wi-Fi unavailable.");
    }
}
bool wifi_scan() { return request({Request::Scan, {}}, "Scanning..."); }
bool wifi_join(std::string_view ssid, std::string_view password) {
    Command cmd{Request::Join, {}};
    if (ssid.empty() || ssid.size() > sizeof(cmd.credentials.ssid) ||
        password.size() > sizeof(cmd.credentials.pass))
        return false;
    memcpy(cmd.credentials.ssid, ssid.data(), ssid.size());
    memcpy(cmd.credentials.pass, password.data(), password.size());
    return request(cmd, "Connecting...");
}
void wifi_save(std::string_view command) {
    command.remove_prefix(3);
    const auto tab = command.find('\t');
    Credentials c{};
    bool ok = tab != command.npos && tab && decode(command.substr(0, tab), c.ssid, sizeof(c.ssid)) &&
              decode(command.substr(tab + 1), c.pass, sizeof(c.pass)) && store(c);
    puts(ok ? "HEMEL_WIFI_SAVED" : "HEMEL_WIFI_INVALID");
}
