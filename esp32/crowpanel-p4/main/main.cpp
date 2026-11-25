#include "display.h"
#include "preferences.h"
#include "settings_ui.h"
#include "source.h"
#include "wifi.h"
#include "panel.h"
#include "driver/uart.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_lvgl_port.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

extern "C" void app_main()
{
    lv_display_t *display = crowpanel_display_init();
    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0, 16384, 0, 0, nullptr, 0));
    lvgl_port_lock(0);
    ESP_ERROR_CHECK(hemel::attach(display) ? ESP_OK : ESP_ERR_INVALID_SIZE);
    hemel::replay(hemel::Sample::Sector);
    const uint32_t start = esp_timer_get_time() / 1000;
    constexpr uint32_t offset = 5000;
    hemel::seek(offset, start);
    lv_refr_now(display);
    lvgl_port_unlock();
    panel::loadPreferences();
    panel::startBacklight();
    ESP_LOGI("hemel", "Sector +5s drawn at %dx%d; listening on UART0 at 115200", hemel::width(), hemel::height());

    panel::hornInit();
    hemel::setArrivalHandler([](hemel::Direction d, bool stopping) {
        panel::trainHorn(d == hemel::Direction::Down, stopping);
    });
    lvgl_port_lock(0);
    auto *settings = lv_button_create(lv_screen_active());
    lv_obj_set_pos(settings, 3, 70);
    lv_obj_set_size(settings, 88, 32);
    auto *label = lv_label_create(settings);
    lv_label_set_text(label, "Settings");
    lv_obj_center(label);
    lv_obj_add_event_cb(settings, [](lv_event_t *) {
        panel::openSettings(nullptr, "Stopping at Hemel only");
    }, LV_EVENT_CLICKED, nullptr);
    lvgl_port_unlock();
    wifi_start(public_feed_start);
    for (;;) {
        char bytes[1024];
        const int n = uart_read_bytes(UART_NUM_0, bytes, sizeof(bytes), pdMS_TO_TICKS(20));
        lvgl_port_lock(0);
        const uint32_t now = esp_timer_get_time() / 1000;
        panel::pollSettings();
        const bool was_live = hemel::isLive();
        if (n > 0) usb_input(bytes, n, now);
        if (!was_live && hemel::isLive()) ESP_LOGI("hemel", "Bridge snapshot accepted");
        if (hemel::isLive()) hemel::updateLive(now);
        else hemel::seek((offset + now - start) % (hemel::duration() + 1), now);
        lvgl_port_unlock();
    }
}
