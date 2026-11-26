#include "settings_display.h"
#include "settings_ui.h"
#include "display.h"
#include "map.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "esp_log.h"
#include <cstring>

namespace lakes {
namespace {
lv_display_t *ui;
lv_indev_t *input;
lv_indev_data_t pointer{};
bool rotated;
bool renderApp;
uint16_t *canvas, *presented;
void flush(lv_display_t *display, const lv_area_t *, uint8_t *data) {
    // FULL mode supplies the entire logical frame on each flush.
    if (panel::settingsOpen()
        || renderApp
    ) {
        presented = crowpanel_back_buffer();
        const auto *src = reinterpret_cast<uint16_t *>(data);
        if (!rotated)
            memcpy(presented, src, panelWidth * panelHeight * sizeof(*src));
        else {
            for (int y0 = 0; y0 < panelWidth; y0 += 16)
                for (int x = 0; x < panelHeight; ++x)
                    for (int y = y0; y < y0 + 16; ++y)
                        presented[x * panelWidth + panelWidth - 1 - y] = src[y * panelHeight + x];
        }
        crowpanel_present();
    }
    lv_display_flush_ready(display);
}
} // namespace
static bool configure(bool portrait) {
    rotated = portrait;
    const int w = portrait ? panelHeight : panelWidth, h = portrait ? panelWidth : panelHeight;
    if (!ui) {
        canvas = static_cast<uint16_t *>(
            heap_caps_aligned_alloc(64, panelWidth * panelHeight * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        if (!canvas) {
            ESP_LOGE("settings", "Settings framebuffer unavailable");
            return false;
        }
        lv_init();
        lv_tick_set_cb([]() -> uint32_t { return esp_timer_get_time() / 1000; });
        ui = lv_display_create(w, h);
        lv_display_set_color_format(ui, LV_COLOR_FORMAT_RGB565);
        lv_display_set_buffers(ui, canvas, nullptr, panelWidth * panelHeight * 2,
                               LV_DISPLAY_RENDER_MODE_FULL);
        lv_display_set_flush_cb(ui, flush);
        input = lv_indev_create();
        lv_indev_set_type(input, LV_INDEV_TYPE_POINTER);
        lv_indev_set_display(input, ui);
        lv_indev_set_read_cb(input, [](lv_indev_t *, lv_indev_data_t *d) {
            d->point = pointer.point;
            d->state = pointer.state;
        });
    } else {
        lv_display_set_resolution(ui, w, h);
        // Reset the draw buffer stride to the new logical width.
        lv_display_set_buffers(ui, canvas, nullptr, panelWidth * panelHeight * 2,
                               LV_DISPLAY_RENDER_MODE_FULL);
    }
    pointer.state = LV_INDEV_STATE_RELEASED;
    return true;
}
lv_display_t *coreDisplay(bool landscapeApp) {
    renderApp=landscapeApp;
    return configure(false)?ui:nullptr;
}
void openPanelSettings(bool portrait) {
    if (!configure(portrait)) return;
    panel::openSettings(requestRedraw, "Stopping trains only");
    lv_refr_now(ui);
}
void settingsPointer(uint16_t px, uint16_t py, bool pressed) {
    pointer.point.x = rotated ? py : px;
    pointer.point.y = rotated ? panelWidth - 1 - px : py;
    pointer.state = pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
    lv_indev_read(input);
}
void updatePanelSettings() {
    panel::pollSettings();
    lv_timer_handler();
}
const uint16_t *settingsFrame() { return presented; }
} // namespace lakes
