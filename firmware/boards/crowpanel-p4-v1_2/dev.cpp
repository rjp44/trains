#include "dev.h"
#include "terrain.h"
#include "display.h"
#include "map.h"
#include "preferences.h"
#include "wifi.h"
#include "driver/uart.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "esp_rom_crc.h"
#include <algorithm>
#include <charconv>
#include <cstdio>
#include <string_view>

namespace {
transport::Package active;
transport::State state{};
uint32_t cursor, started;
uint16_t *presented;
bool playing;
uint32_t now() { return esp_timer_get_time() / 1000; }
bool number(std::string_view arg, unsigned &value) {
    auto end = arg.data() + arg.size();
    auto result = std::from_chars(arg.data(), end, value);
    return result.ec == std::errc{} && result.ptr == end;
}
void show(uint32_t ms) {
    cursor = std::min(ms, active.frames.back().at);
    state = transport::seek(active, cursor);
    presented = crowpanel_back_buffer();
    lakes::drawOverlay(presented);
    crowpanel_present();
}
void report() {
    printf("TDP FRAME %lu %s %d %d %s %d %s %d %08lx\n", (unsigned long)cursor,
           state.berth ? state.berth->id.c_str() : "-", state.berth ? active.x + state.berth->offset : -1,
           state.track ? state.track->y : -1,
           state.card && state.frame->matched ? active.service.c_str() : "-", state.entryMs,
           state.entryMs < 0 ? "-" : state.entryDirection.c_str(), state.bookedEntry,
           (unsigned long)esp_rom_crc32_le(0, (uint8_t *)presented, 1024 * 600 * 2));
}
void receive(unsigned size) {
    if (size < 52 || size > transport::maxPackage) {
        puts("TDP ERROR size");
        return;
    }
    auto *buf = static_cast<uint8_t *>(heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!buf) {
        puts("TDP ERROR memory");
        return;
    }
    puts("TDP READY");
    size_t used = 0;
    const uint32_t start = now();
    while (used < size && now() - start < 15000) {
        int n =
            uart_read_bytes(UART_NUM_0, buf + used, std::min<size_t>(size - used, 1024), pdMS_TO_TICKS(1200));
        if (n <= 0)
            break;
        used += n;
    }
    bool ok = used == size && transport::mount(buf, size, active);
    free(buf);
    if (!ok) {
        puts("TDP ERROR package");
        return;
    }
    playing = false;
    show(0);
    printf("TDP LOADED %s %s %u\n", active.app.c_str(), active.version.c_str(), size);
}
void command(std::string_view cmd) {
    unsigned arg;
    if (cmd == "INFO") {
        printf("TDP INFO sound=%u volume=%u brightness=%u wifi=%u internal_min=%u psram_min=%u\n",
               unsigned(panel::sound()), panel::volume(), panel::brightness(),
               unsigned(wifi_link_state() & 1),
               unsigned(heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)),
               unsigned(heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM)));
    } else if (cmd.substr(0, 5) == "LOAD " && number(cmd.substr(5), arg))
        receive(arg);
    else if (cmd == "BENCH" || cmd == "BENCH TLS") {
        playing = false;
        if (cmd == "BENCH TLS") {
            auto start = now();
            while (!(lakes::httpsActivity() & 1) && now() - start < 65000)
                vTaskDelay(pdMS_TO_TICKS(10));
            if (!(lakes::httpsActivity() & 1)) {
                puts("TDP ERROR no HTTPS request");
                return;
            }
        }
        bool ok = lakes::benchmarkTerrain();
        if (!active.frames.empty())
            show(cursor);
        puts(ok ? "TDP BENCH OK" : "TDP ERROR benchmark");
    } else if (active.frames.empty())
        puts("TDP ERROR load a package first");
    else if (cmd.substr(0, 5) == "SEEK " && number(cmd.substr(5), arg)) {
        playing = false;
        show(arg);
        report();
    } else if (cmd == "PLAY") {
        if (cursor == active.frames.back().at)
            show(0);
        started = now() - cursor;
        playing = true;
        puts("TDP PLAYING");
    } else if (cmd.substr(0, 6) == "PIXEL ") {
        unsigned x, y;
        auto split = cmd.find(' ', 6);
        if (split == cmd.npos || !number(cmd.substr(6, split - 6), x) || !number(cmd.substr(split + 1), y) ||
            x >= 1024 || y >= 600) {
            puts("TDP ERROR coordinates");
            return;
        }
        printf("TDP PIXEL %04x\n", presented[y * 1024 + x]);
    } else
        puts("TDP ERROR command");
}
} // namespace
void transport::paintActive(Painter painter) { draw(active, state, painter); }
extern "C" void app_main() {
    crowpanel_display_init();
    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0, 8192, 0, 0, nullptr, 0));
    lakes::init();
    lakes::initFeedQueue();
    lakes::render(crowpanel_back_buffer(), now());
    crowpanel_present();
    crowpanel_prime_other_buffer();
    panel::loadPreferences();
    panel::startBacklight();
    wifi_start(public_feed_start);
    // Read command bytes individually so LOAD can switch to exact-length binary input.
    std::string line;
    for (;;) {
        char c;
        if (uart_read_bytes(UART_NUM_0, &c, 1, pdMS_TO_TICKS(20)) == 1) {
            if (c == '\n') {
                command(line);
                line.clear();
            } else if (c != '\r' && line.size() < 80)
                line += c;
        }
        if (playing) {
            uint32_t ms = now() - started;
            if (transport::seek(active, ms).frame != state.frame)
                show(ms);
            if (ms >= active.frames.back().at)
                playing = false;
        }
    }
}
