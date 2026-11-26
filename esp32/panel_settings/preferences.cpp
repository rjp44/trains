#include "preferences.h"
#include "driver/ledc.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <algorithm>
#include <atomic>

namespace panel {
namespace {
std::atomic<Sound> mode{Sound::All};
std::atomic<unsigned> gain{100};
unsigned light = 100;
bool pwm;
constexpr auto speed = LEDC_LOW_SPEED_MODE;
constexpr auto channel = LEDC_CHANNEL_0;
} // namespace
Sound sound() { return mode.load(); }
unsigned volume() { return gain.load(); }
unsigned brightness() { return light; }
void setSound(Sound value) { mode = value; }
void setVolume(unsigned value) { gain = std::min(value, 100u); }
bool setBrightness(unsigned value) {
    value = std::clamp(value, 10u, 100u);
    if (!pwm)
        return false;
    if (value == 100) {
        if (ledc_stop(speed, channel, 1) != ESP_OK)
            return false;
    } else if (ledc_set_duty(speed, channel, 1024 * value / 100) != ESP_OK ||
               ledc_update_duty(speed, channel) != ESP_OK)
        return false;
    light = value;
    return true;
}
void loadPreferences() {
    if (nvs_flash_init() != ESP_OK) {
        ESP_LOGW("settings", "Preferences unavailable");
        return;
    }
    nvs_handle_t n;
    if (nvs_open("hemel", NVS_READONLY, &n) != ESP_OK)
        return;
    uint8_t v;
    if (nvs_get_u8(n, "horn_mode", &v) == ESP_OK && v <= uint8_t(Sound::All))
        mode = Sound(v);
    if (nvs_get_u8(n, "horn_volume", &v) == ESP_OK && v <= 100)
        gain = v;
    if (nvs_get_u8(n, "backlight", &v) == ESP_OK && v >= 10 && v <= 100)
        light = v;
    nvs_close(n);
}
bool savePreferences() {
    nvs_handle_t n;
    if (nvs_open("hemel", NVS_READWRITE, &n) != ESP_OK)
        return false;
    bool ok = nvs_set_u8(n, "horn_mode", uint8_t(sound())) == ESP_OK &&
              nvs_set_u8(n, "horn_volume", volume()) == ESP_OK &&
              nvs_set_u8(n, "backlight", light) == ESP_OK && nvs_commit(n) == ESP_OK;
    nvs_close(n);
    if (ok)
        ESP_LOGI("settings", "Saved horn mode %u, volume %u%%, backlight %u%%", unsigned(sound()), volume(),
                 brightness());
    return ok;
}
bool gateBacklight(bool off) {
    if (!pwm) return gpio_set_level(GPIO_NUM_31, off ? 0 : 1) == ESP_OK;
    return off ? ledc_stop(speed, channel, 0) == ESP_OK : setBrightness(light);
}
void startBacklight() {
    ledc_timer_config_t timer{};
    timer.speed_mode = speed;
    timer.timer_num = LEDC_TIMER_0;
    timer.freq_hz = 30000;
    timer.duty_resolution = LEDC_TIMER_10_BIT;
    timer.clk_cfg = LEDC_AUTO_CLK;
    ledc_channel_config_t out{};
    out.gpio_num = 31;
    out.speed_mode = speed;
    out.channel = channel;
    out.timer_sel = timer.timer_num;
    out.duty = 1023 * light / 100;
    pwm = ledc_timer_config(&timer) == ESP_OK && ledc_channel_config(&out) == ESP_OK;
    if (!setBrightness(light)) {
        // Keep the settings accessible even if PWM initialization fails.
        ESP_LOGW("settings", "Backlight dimming unavailable");
        gpio_reset_pin(GPIO_NUM_31);
        gpio_set_level(GPIO_NUM_31, 1);
        gpio_set_direction(GPIO_NUM_31, GPIO_MODE_OUTPUT);
        light = 100;
    }
    ESP_LOGI("settings", "Applied horn mode %u, volume %u%%, backlight %u%%", unsigned(sound()), volume(),
             brightness());
}
} // namespace panel
