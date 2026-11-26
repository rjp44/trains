// Elecrow CrowPanel Advanced 10.1-inch P4 V1.2, 1024 x 600.
// Pinout and timing source: vendor IDF Lesson09, linked in esp32/README.md.
#include "display.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_cache.h"
#include "esp_lcd_ek79007.h"
#include "esp_lcd_mipi_dsi.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch_gt911.h"
#include "esp_ldo_regulator.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <string.h>

enum { WIDTH = 1024, HEIGHT = 600 };

static void panel_power(void) {
    static esp_ldo_channel_handle_t io_supply, panel_supply;
    const esp_ldo_channel_config_t io = {.chan_id = 3, .voltage_mv = 2500};
    const esp_ldo_channel_config_t lcd = {.chan_id = 4, .voltage_mv = 3300};
    ESP_ERROR_CHECK(esp_ldo_acquire_channel(&io, &io_supply));
    ESP_ERROR_CHECK(esp_ldo_acquire_channel(&lcd, &panel_supply));

    // Keep the backlight dark until the first complete frame and saved level are ready.
    ESP_ERROR_CHECK(gpio_set_level(GPIO_NUM_31, 0));
    ESP_ERROR_CHECK(gpio_set_direction(GPIO_NUM_31, GPIO_MODE_OUTPUT));
}

static esp_lcd_panel_io_handle_t touch_io;
static uint8_t touch_capacity;
uint8_t crowpanel_touch_capacity(void) { return touch_capacity; }

static esp_lcd_touch_handle_t touch_init(void) {
    const i2c_master_bus_config_t cfg = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = GPIO_NUM_45,
        .scl_io_num = GPIO_NUM_46,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    i2c_master_bus_handle_t bus;
    ESP_ERROR_CHECK(i2c_new_master_bus(&cfg, &bus));

    static esp_lcd_touch_io_gt911_config_t address;
    esp_lcd_touch_config_t touch_cfg = {
        .x_max = WIDTH,
        .y_max = HEIGHT,
        .rst_gpio_num = GPIO_NUM_40,
        .int_gpio_num = GPIO_NUM_42,
        .driver_data = &address,
    };
    const uint8_t addresses[] = {ESP_LCD_TOUCH_IO_I2C_GT911_ADDRESS,
                                 ESP_LCD_TOUCH_IO_I2C_GT911_ADDRESS_BACKUP};
    for (size_t i = 0; i < sizeof(addresses); ++i) {
        address.dev_addr = addresses[i];
        esp_lcd_panel_io_i2c_config_t io_cfg = ESP_LCD_TOUCH_IO_I2C_GT911_CONFIG();
        io_cfg.dev_addr = address.dev_addr;
        io_cfg.scl_speed_hz = 400000;
        esp_lcd_panel_io_handle_t io;
        ESP_ERROR_CHECK(esp_lcd_new_panel_io_i2c(bus, &io_cfg, &io));
        esp_lcd_touch_handle_t touch = NULL;
        if (esp_lcd_touch_new_i2c_gt911(io, &touch_cfg, &touch) == ESP_OK) {
            touch_io = io;
            uint8_t config;
            if (esp_lcd_panel_io_rx_param(io, 0x804c, &config, 1) == ESP_OK)
                touch_capacity = config & 15;
            ESP_LOGI("touch", "GT911 configured for %u contacts", touch_capacity);
            return touch;
        }
        ESP_ERROR_CHECK(esp_lcd_panel_io_del(io));
    }
    ESP_LOGW("hemel", "GT911 unavailable; continuing with the rail display");
    return NULL;
}

static esp_lcd_panel_handle_t panel;
static esp_lcd_touch_handle_t touch;
static SemaphoreHandle_t refreshed;
static volatile uint32_t refresh_count;
static uint16_t *buffers[2];
static unsigned front;

static bool IRAM_ATTR frame_done(esp_lcd_panel_handle_t handle, esp_lcd_dpi_panel_event_data_t *event,
                                 void *ctx) {
    BaseType_t wake = pdFALSE;
    ++refresh_count;
    xSemaphoreGiveFromISR(refreshed, &wake);
    return wake == pdTRUE;
}

void crowpanel_display_init(void) {
    panel_power();
    touch = touch_init();
    const esp_lcd_dsi_bus_config_t dsi = {
        .bus_id = 0,
        .num_data_lanes = 2,
        .phy_clk_src = MIPI_DSI_PHY_CLK_SRC_DEFAULT,
        .lane_bit_rate_mbps = 1000,
    };
    const esp_lcd_dbi_io_config_t dbi = {.virtual_channel = 0, .lcd_cmd_bits = 8, .lcd_param_bits = 8};
    esp_lcd_dsi_bus_handle_t bus;
    esp_lcd_panel_io_handle_t io;
    ESP_ERROR_CHECK(esp_lcd_new_dsi_bus(&dsi, &bus));
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_dbi(bus, &dbi, &io));

    const esp_lcd_dpi_panel_config_t dpi = {
        .dpi_clk_src = MIPI_DSI_DPI_CLK_SRC_DEFAULT,
        .dpi_clock_freq_mhz = 51,
        .pixel_format = LCD_COLOR_PIXEL_FORMAT_RGB565,
        .num_fbs = 2,
        .video_timing =
            {
                .h_size = WIDTH,
                .v_size = HEIGHT,
                .hsync_back_porch = 160,
                .hsync_pulse_width = 70,
                .hsync_front_porch = 160,
                .vsync_back_porch = 23,
                .vsync_pulse_width = 10,
                .vsync_front_porch = 12,
            },
    };
    const ek79007_vendor_config_t controller = {.mipi_config = {.dsi_bus = bus, .dpi_config = &dpi}};
    const esp_lcd_panel_dev_config_t panel_cfg = {
        // V1.2 schematic: U7 GPIO41 -> J21 pin 27 (LCD_RESET).
        .reset_gpio_num = GPIO_NUM_41,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = (void *)&controller,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_ek79007(io, &panel_cfg, &panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(
        esp_lcd_dpi_panel_get_frame_buffer(panel, 2, (void **)&buffers[0], (void **)&buffers[1]));
    for (int i = 0; i < 2; ++i) {
        memset(buffers[i], 0, WIDTH * HEIGHT * sizeof(uint16_t));
        ESP_ERROR_CHECK(
            esp_cache_msync(buffers[i], WIDTH * HEIGHT * sizeof(uint16_t), ESP_CACHE_MSYNC_FLAG_DIR_C2M));
    }
    refreshed = xSemaphoreCreateBinary();
    ESP_ERROR_CHECK(refreshed ? ESP_OK : ESP_ERR_NO_MEM);
    const esp_lcd_dpi_panel_event_callbacks_t callbacks = {.on_refresh_done = frame_done};
    ESP_ERROR_CHECK(esp_lcd_dpi_panel_register_event_callbacks(panel, &callbacks, NULL));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
}

const uint16_t *crowpanel_front_buffer(void) { return buffers[front]; }
uint16_t *crowpanel_back_buffer(void) { return buffers[front ^ 1]; }
uint32_t crowpanel_refresh_count(void) { return refresh_count; }

void crowpanel_present(void) {
    unsigned next = front ^ 1;
    // A native DPI framebuffer pointer asks IDF to write back the cache and switch
    // the DMA descriptor at the next frame boundary. No copy into the front buffer.
    ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(panel, 0, 0, WIDTH, HEIGHT, buffers[next]));
    // Two completed refreshes guarantee the previous buffer is idle even when the
    // first interrupt coincides with the call above.
    uint32_t start = refresh_count;
    while (refresh_count - start < 2)
        ESP_ERROR_CHECK(xSemaphoreTake(refreshed, pdMS_TO_TICKS(250)) ? ESP_OK : ESP_ERR_TIMEOUT);
    front = next;
}

void crowpanel_prime_other_buffer(void) {
    memcpy(crowpanel_back_buffer(), buffers[front], WIDTH * HEIGHT * sizeof(uint16_t));
    ESP_ERROR_CHECK(esp_cache_msync(crowpanel_back_buffer(), WIDTH * HEIGHT * sizeof(uint16_t),
                                    ESP_CACHE_MSYNC_FLAG_DIR_C2M));
}

bool crowpanel_touch(TouchFrame *frame) {
    // Only a ready report with zero contacts is a release. Polls between reports carry no event.
    uint8_t status;
    if (!touch || esp_lcd_panel_io_rx_param(touch_io, 0x814e, &status, 1) != ESP_OK ||
        !(status & 0x80) || esp_lcd_touch_read_data(touch) != ESP_OK)
        return false;
    esp_lcd_touch_point_data_t points[2];
    uint8_t count = 0;
    if (esp_lcd_touch_get_data(touch, points, &count, 2) != ESP_OK) return false;
    frame->count = count;
    for (unsigned i = 0; i < count; ++i)
        frame->points[i] = (TouchPoint){points[i].x, points[i].y};
    return true;
}
