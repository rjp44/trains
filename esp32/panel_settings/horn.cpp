#include "preferences.h"
#include "horn_pcm.h"
#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include <algorithm>
#include <cmath>

namespace {
constexpr unsigned block = 128;
struct Entry {
    uint32_t tick;
    hemel::Direction direction;
    bool bookedStop;
};
constexpr gpio_num_t mute = GPIO_NUM_30;
QueueHandle_t entries;
i2s_chan_handle_t tx;

bool play(hemel::Direction direction, unsigned volume) {
    int16_t pcm[block * 2];
    for (unsigned offset = 0; offset < horn::frames; offset += block) {
        const unsigned n = std::min(block, horn::frames - offset);
        horn::render(direction, offset, n, pcm);
        if (volume < 100)
            for (unsigned i = 0; i < n * 2; ++i)
                pcm[i] = int(pcm[i]) * int(volume) / 100;
        size_t wrote;
        if (i2s_channel_write(tx, pcm, n * 4, &wrote, 250) != ESP_OK || wrote != n * 4)
            return false;
    }
    return true;
}

void playback(void *) {
    Entry entry;
    for (;;) {
        xQueueReceive(entries, &entry, portMAX_DELAY);
        const auto mode = panel::sound();
        const auto gain = panel::volume();
        if (!gain || mode == panel::Sound::Off || (mode == panel::Sound::Stops && !entry.bookedStop))
            continue;
        if (xTaskGetTickCount() - entry.tick > pdMS_TO_TICKS(3500))
            continue;
        if (i2s_channel_enable(tx) != ESP_OK) {
            ESP_LOGW("horn", "Speaker clock unavailable");
            continue;
        }
        gpio_set_level(mute, 0);
        const bool ok = play(entry.direction, gain);
        gpio_set_level(mute, 1);
        i2s_channel_disable(tx);
        if (ok)
            ESP_LOGI("horn", "%s station entry played",
                     entry.direction == hemel::Direction::Down ? "Down" : "Up");
        else
            ESP_LOGW("horn", "I2S output interrupted");
    }
}
} // namespace

void panel::hornInit() {
    gpio_set_level(mute, 1);
    gpio_set_direction(mute, GPIO_MODE_OUTPUT);
    i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
    chan.auto_clear = true;
    chan.dma_desc_num = 4;
    chan.dma_frame_num = block;
    i2s_std_config_t fmt = {};
    fmt.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(horn::rate);
    fmt.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO);
    fmt.gpio_cfg.mclk = I2S_GPIO_UNUSED;
    fmt.gpio_cfg.bclk = GPIO_NUM_22;
    fmt.gpio_cfg.ws = GPIO_NUM_21;
    fmt.gpio_cfg.dout = GPIO_NUM_23;
    fmt.gpio_cfg.din = I2S_GPIO_UNUSED;
    if (i2s_new_channel(&chan, &tx, nullptr) == ESP_OK && i2s_channel_init_std_mode(tx, &fmt) == ESP_OK) {
        entries = xQueueCreate(8, sizeof(Entry));
        if (entries && xTaskCreate(playback, "horn", 4096, nullptr, 4, nullptr) == pdPASS)
            return;
    }
    entries = nullptr;
    ESP_LOGW("horn", "Speaker unavailable");
}
void panel::trainHorn(bool down, bool bookedStop) {
    if (sound() == Sound::Off || !volume() || (sound() == Sound::Stops && !bookedStop))
        return;
    const Entry entry{xTaskGetTickCount(), down ? hemel::Direction::Down : hemel::Direction::Up,
                      bookedStop};
    if (entries)
        xQueueSend(entries, &entry, 0);
}
