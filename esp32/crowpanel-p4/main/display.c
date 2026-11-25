// Elecrow CrowPanel Advanced 10.1-inch P4 V1.2, 1024 x 600.
// Pinout and timing source: vendor IDF Lesson09, linked in esp32/README.md.
#include "display.h"
#include "driver/i2c_master.h"
#include "driver/ledc.h"
#include "esp_lcd_ek79007.h"
#include "esp_lcd_mipi_dsi.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch_gt911.h"
#include "esp_ldo_regulator.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"

enum { WIDTH = 1024, HEIGHT = 600 };

static void panel_power(void)
{
    static esp_ldo_channel_handle_t io_supply, panel_supply;
    const esp_ldo_channel_config_t io = {.chan_id = 3, .voltage_mv = 2500};
    const esp_ldo_channel_config_t lcd = {.chan_id = 4, .voltage_mv = 3300};
    ESP_ERROR_CHECK(esp_ldo_acquire_channel(&io, &io_supply));
    ESP_ERROR_CHECK(esp_ldo_acquire_channel(&lcd, &panel_supply));

    const ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE, .timer_num = LEDC_TIMER_0,
        .duty_resolution = LEDC_TIMER_11_BIT, .freq_hz = 30000, .clk_cfg = LEDC_USE_PLL_DIV_CLK,
    };
    const ledc_channel_config_t backlight = {
        .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_0,
        .timer_sel = LEDC_TIMER_0, .gpio_num = GPIO_NUM_31, .duty = 0,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&timer));
    ESP_ERROR_CHECK(ledc_channel_config(&backlight));
}

void crowpanel_backlight_on(void)
{
    ESP_ERROR_CHECK(ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, 2000));
    ESP_ERROR_CHECK(ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0));
}

static esp_lcd_touch_handle_t touch_init(void)
{
    const i2c_master_bus_config_t cfg = {
        .i2c_port = I2C_NUM_0, .sda_io_num = GPIO_NUM_45, .scl_io_num = GPIO_NUM_46,
        .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7, .flags.enable_internal_pullup = true,
    };
    i2c_master_bus_handle_t bus;
    ESP_ERROR_CHECK(i2c_new_master_bus(&cfg, &bus));

    static esp_lcd_touch_io_gt911_config_t address;
    esp_lcd_touch_config_t touch_cfg = {
        .x_max = WIDTH, .y_max = HEIGHT, .rst_gpio_num = GPIO_NUM_40, .int_gpio_num = GPIO_NUM_42,
        .driver_data = &address,
    };
    const uint8_t addresses[] = {ESP_LCD_TOUCH_IO_I2C_GT911_ADDRESS, ESP_LCD_TOUCH_IO_I2C_GT911_ADDRESS_BACKUP};
    for (size_t i = 0; i < sizeof(addresses); ++i) {
        address.dev_addr = addresses[i];
        esp_lcd_panel_io_i2c_config_t io_cfg = ESP_LCD_TOUCH_IO_I2C_GT911_CONFIG();
        io_cfg.dev_addr = address.dev_addr;
        io_cfg.scl_speed_hz = 400000;
        esp_lcd_panel_io_handle_t io;
        ESP_ERROR_CHECK(esp_lcd_new_panel_io_i2c(bus, &io_cfg, &io));
        esp_lcd_touch_handle_t touch = NULL;
        if (esp_lcd_touch_new_i2c_gt911(io, &touch_cfg, &touch) == ESP_OK) return touch;
        ESP_ERROR_CHECK(esp_lcd_panel_io_del(io));
    }
    ESP_LOGW("hemel", "GT911 unavailable; continuing with the rail display");
    return NULL;
}

lv_display_t *crowpanel_display_init(void)
{
    panel_power();
    esp_lcd_touch_handle_t touch = touch_init();
    const esp_lcd_dsi_bus_config_t dsi = {
        .bus_id = 0, .num_data_lanes = 2, .phy_clk_src = MIPI_DSI_PHY_CLK_SRC_DEFAULT, .lane_bit_rate_mbps = 900,
    };
    const esp_lcd_dbi_io_config_t dbi = {.virtual_channel = 0, .lcd_cmd_bits = 8, .lcd_param_bits = 8};
    esp_lcd_dsi_bus_handle_t bus;
    esp_lcd_panel_io_handle_t io;
    ESP_ERROR_CHECK(esp_lcd_new_dsi_bus(&dsi, &bus));
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_dbi(bus, &dbi, &io));

    const esp_lcd_dpi_panel_config_t dpi = {
        .dpi_clk_src = MIPI_DSI_DPI_CLK_SRC_DEFAULT, .dpi_clock_freq_mhz = 51,
        .pixel_format = LCD_COLOR_PIXEL_FORMAT_RGB565, .num_fbs = 1,
        .video_timing = {
            .h_size = WIDTH, .v_size = HEIGHT, .hsync_back_porch = 160, .hsync_pulse_width = 70,
            .hsync_front_porch = 160, .vsync_back_porch = 23, .vsync_pulse_width = 10, .vsync_front_porch = 12,
        },
        .flags.use_dma2d = true,
    };
    const ek79007_vendor_config_t controller = {.mipi_config = {.dsi_bus = bus, .dpi_config = &dpi}};
    const esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = -1, .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16, .vendor_config = (void *)&controller,
    };
    esp_lcd_panel_handle_t panel;
    ESP_ERROR_CHECK(esp_lcd_new_panel_ek79007(io, &panel_cfg, &panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));

    lvgl_port_cfg_t gui = ESP_LVGL_PORT_INIT_CONFIG();
    gui.task_stack = 16384;
    gui.task_max_sleep_ms = 20;
    ESP_ERROR_CHECK(lvgl_port_init(&gui));
    const lvgl_port_display_cfg_t disp_cfg = {
        .io_handle = io, .panel_handle = panel, .control_handle = panel,
        .buffer_size = WIDTH * 24, .hres = WIDTH, .vres = HEIGHT,
        .color_format = LV_COLOR_FORMAT_RGB565, .flags = {.buff_dma = true, .swap_bytes = true},
    };
    const lvgl_port_display_dsi_cfg_t dsi_port = {0};
    lv_display_t *display = lvgl_port_add_disp_dsi(&disp_cfg, &dsi_port);
    ESP_ERROR_CHECK(display ? ESP_OK : ESP_ERR_NO_MEM);
    if (touch) {
        const lvgl_port_touch_cfg_t input = {.disp = display, .handle = touch};
        ESP_ERROR_CHECK(lvgl_port_add_touch(&input) ? ESP_OK : ESP_ERR_NO_MEM);
    }
    return display;
}
