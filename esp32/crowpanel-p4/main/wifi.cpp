#include "wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <atomic>
#include <cstdio>
#include <cstring>

namespace {
static_assert(CONFIG_ESP_HOSTED_SDIO_BUS_WIDTH == 4 && CONFIG_ESP_HOSTED_SDIO_SLOT == 1 &&
              CONFIG_ESP_HOSTED_SDIO_PIN_CLK == 18 && CONFIG_ESP_HOSTED_SDIO_PIN_CMD == 19 &&
              CONFIG_ESP_HOSTED_SDIO_PIN_D0 == 17 && CONFIG_ESP_HOSTED_SDIO_PIN_D1 == 16 &&
              CONFIG_ESP_HOSTED_SDIO_PIN_D2 == 15 && CONFIG_ESP_HOSTED_SDIO_PIN_D3 == 14 &&
              CONFIG_ESP_HOSTED_SDIO_GPIO_RESET_SLAVE == 32, "Check CrowPanel V1.2 SDIO configuration");
struct Credentials { uint8_t ssid[32], pass[64]; };
EventGroupHandle_t events;
std::atomic<uint32_t> linkState{0};
constexpr EventBits_t connected = BIT0, disconnected = BIT1;

int digit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    return c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
}
bool decode(std::string_view value, uint8_t *out, size_t max) {
    if (value.size() % 2 || value.size()/2 > max) return false;
    for (size_t i = 0; i < value.size(); i += 2) {
        int high = digit(value[i]), low = digit(value[i+1]);
        if (high < 0 || low < 0 || (high == 0 && low == 0)) return false;
        out[i/2] = (high << 4) | low;
    }
    return true;
}

void wifi_event(void *, esp_event_base_t base, int32_t id, void *) {
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        linkState = (linkState.load() + 1) | 1u;
        xEventGroupSetBits(events, connected);
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        linkState = (linkState.load() + 2) & ~1u;
        xEventGroupSetBits(events, disconnected);
    }
}

void station(void *) {
    wifi_config_t cfg = {};
    nvs_handle_t handle;
    if (nvs_open("hemel", NVS_READONLY, &handle) != ESP_OK) { vTaskDelete(nullptr); return; }
    Credentials saved = {};
    size_t size = sizeof(saved);
    const bool found = nvs_get_blob(handle, "wifi", &saved, &size) == ESP_OK && size == sizeof(saved);
    nvs_close(handle);
    if (!found) { vTaskDelete(nullptr); return; }
    memcpy(cfg.sta.ssid, saved.ssid, sizeof(saved.ssid));
    memcpy(cfg.sta.password, saved.pass, sizeof(saved.pass));
    cfg.sta.threshold.authmode = saved.pass[0] ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    events = xEventGroupCreate();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    if (!events || esp_netif_init() != ESP_OK || esp_event_loop_create_default() != ESP_OK ||
        !esp_netif_create_default_wifi_sta() ||
        esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, wifi_event, nullptr) != ESP_OK ||
        esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, nullptr) != ESP_OK ||
        esp_wifi_init(&init) != ESP_OK || esp_wifi_set_storage(WIFI_STORAGE_RAM) != ESP_OK ||
        esp_wifi_set_mode(WIFI_MODE_STA) != ESP_OK || esp_wifi_set_config(WIFI_IF_STA, &cfg) != ESP_OK ||
        esp_wifi_start() != ESP_OK) {
        ESP_LOGW("hemel", "Wi-Fi initialization failed");
        vTaskDelete(nullptr);
        return;
    }

    bool started = false;
    unsigned backoff = 1;
    for (;;) {
        esp_wifi_connect();
        EventBits_t bits = xEventGroupWaitBits(events, connected | disconnected, pdTRUE, pdFALSE, pdMS_TO_TICKS(30000));
        if (bits & connected) {
            backoff = 1;
            if (!started) {
                esp_sntp_config_t clock = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
                if (esp_netif_sntp_init(&clock) == ESP_OK) {
                    public_feed_start();
                    started = true;
                }
            }
            if (!(bits & disconnected)) xEventGroupWaitBits(events, disconnected, pdTRUE, pdTRUE, portMAX_DELAY);
        }
        vTaskDelay(pdMS_TO_TICKS(1000 * backoff));
        if (backoff < 16) backoff *= 2;
    }
}
}

uint32_t wifi_link_state() { return linkState.load(); }

void wifi_start() {
    if (nvs_flash_init() != ESP_OK) {
        ESP_LOGW("hemel", "NVS unavailable");
        return;
    }
    xTaskCreate(station, "station", 6144, nullptr, 4, nullptr);
}

void wifi_save(std::string_view command) {
    // W1 <tab> hex SSID <tab> hex passphrase, accepted only on the local UART.
    command.remove_prefix(3);
    const auto tab = command.find('\t');
    Credentials value = {};
    nvs_handle_t handle;
    bool ok = tab != command.npos && tab && decode(command.substr(0,tab), value.ssid, sizeof(value.ssid)) &&
        decode(command.substr(tab+1), value.pass, sizeof(value.pass)) && nvs_open("hemel", NVS_READWRITE, &handle) == ESP_OK;
    if (ok) {
        ok = nvs_set_blob(handle, "wifi", &value, sizeof(value)) == ESP_OK && nvs_commit(handle) == ESP_OK;
        nvs_close(handle);
    }
    puts(ok ? "HEMEL_WIFI_SAVED" : "HEMEL_WIFI_INVALID");
}
