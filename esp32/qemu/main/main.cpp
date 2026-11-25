#include "panel.h"
#include "driver/uart.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_qemu_rgb.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstdlib>

namespace {
uint32_t ticks() { return uint32_t(esp_timer_get_time() / 1000); }
void flush(lv_display_t *display, const lv_area_t *a, uint8_t *pixels) {
    auto panel = static_cast<esp_lcd_panel_handle_t>(lv_display_get_user_data(display));
    ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(panel, a->x1, a->y1, a->x2 + 1, a->y2 + 1, pixels));
    lv_display_flush_ready(display);
}
} // namespace

extern "C" void app_main() {
    const int w = hemel::width(), h = hemel::height();
    ESP_ERROR_CHECK(w <= 800 && h <= 600 ? ESP_OK : ESP_ERR_INVALID_SIZE);
    esp_lcd_rgb_qemu_config_t config{uint32_t(w), uint32_t(h), RGB_QEMU_BPP_16};
    esp_lcd_panel_handle_t panel;
    ESP_ERROR_CHECK(esp_lcd_new_rgb_qemu(&config, &panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
    lv_init();
    lv_tick_set_cb(ticks);
    auto *display = lv_display_create(w, h);
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
    const size_t bytes = lv_draw_buf_width_to_stride(w, LV_COLOR_FORMAT_RGB565) * 24;
    void *stripe = std::malloc(bytes);
    ESP_ERROR_CHECK(stripe ? ESP_OK : ESP_ERR_NO_MEM);
    lv_display_set_buffers(display, stripe, nullptr, bytes, LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_user_data(display, panel);
    lv_display_set_flush_cb(display, flush);
    ESP_ERROR_CHECK(hemel::attach(display) ? ESP_OK : ESP_ERR_INVALID_SIZE);
    hemel::setArrivalHandler([](hemel::Direction d) { ESP_LOGI("hemel", "Station entry %s", d == hemel::Direction::Down ? "Down" : "Up"); });
    hemel::replay(hemel::Sample::Sector);
    // UART0 carries host snapshots and simulated touch on a board-independent link.
    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0, 16384, 0, 0, nullptr, 0));
    const uint32_t start = ticks();
    // Begin with the same occupied replay frame as the desktop smoke check.
    constexpr uint32_t offset = 5000;
    hemel::seek(offset, start);
    lv_refr_now(display);
    ESP_LOGI("hemel", "Rendered sector replay +5s on QEMU RGB565, %dx%d, draw buffer %u bytes", w, h,
             unsigned(bytes));
    for (;;) {
        const uint32_t now = ticks();
        char bytes[512];
        const bool wasLive = hemel::isLive();
        for (int i = 0; i < 16; i++) {
            int n = uart_read_bytes(UART_NUM_0, bytes, sizeof(bytes), 0);
            if (n <= 0)
                break;
            hemel::feedInput(bytes, n, now);
        }
        if (!wasLive && hemel::isLive())
            ESP_LOGI("hemel", "Bridge snapshot accepted");
        if (hemel::isLive())
            hemel::updateLive(now);
        else
            hemel::seek((offset + now - start) % (hemel::duration() + 1), now);
        lv_timer_handler();
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
