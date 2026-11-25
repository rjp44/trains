#include "panel.h"
#include <SDL.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>
#include <cerrno>
#include <fcntl.h>
#include <unistd.h>

namespace {
using hemel::Sample;
using hemel::View;
struct Options {
    Sample sample = Sample::Sector;
    View view = View::Sector;
    uint32_t at = 0;
    std::string output;
    bool light = false, live = false;
    std::vector<SDL_Point> taps;
};
int preset(const std::string &name) {
    if (name == "sector")
        return 0;
    if (name == "hemel")
        return 1;
    if (name == "watford")
        return 2;
    throw std::runtime_error("Choose sector, hemel or watford");
}
Options parse(int argc, char **argv) {
    Options o;
    for (int i = 1; i < argc; i++) {
        std::string key = argv[i];
        if (key == "--light") {
            o.light = true;
            continue;
        }
        if (key == "--live") {
            o.live = true;
            continue;
        }
        if (key == "--help") {
            std::puts("hemel-sim [--sample sector|hemel|watford] [--view sector|hemel|watford] [--at "
                      "seconds] [--light] [--live] [--tap x,y] [--output file.bmp]\n"
                      "Space pauses. Left/right seek 10 seconds. With --live, read bridge frames on stdin. "
                      "1/2/3 select a view. Tab changes recording. "
                      "T changes theme. F changes speed.");
            std::exit(0);
        }
        if (++i >= argc)
            throw std::runtime_error("Missing value for " + key);
        std::string arg = argv[i];
        if (key == "--view")
            o.view = static_cast<View>(preset(arg));
        else if (key == "--sample")
            o.sample = static_cast<Sample>(preset(arg));
        else if (key == "--output")
            o.output = arg;
        else if (key == "--tap") {
            SDL_Point p;
            char extra;
            if (std::sscanf(arg.c_str(), "%d,%d%c", &p.x, &p.y, &extra) != 2 || p.x < 0 ||
                p.x >= hemel::width() || p.y < 0 || p.y >= hemel::height())
                throw std::runtime_error("Invalid tap coordinates");
            o.taps.push_back(p);
        } else if (key == "--at") {
            size_t used;
            double seconds = std::stod(arg, &used);
            if (!std::isfinite(seconds) || seconds < 0 || seconds > 4294967 || used != arg.size())
                throw std::runtime_error("Invalid replay time");
            o.at = uint32_t(std::lround(seconds * 1000));
        } else
            throw std::runtime_error("Unknown option " + key);
    }
    return o;
}
void check(bool ok) {
    if (!ok)
        throw std::runtime_error(SDL_GetError());
}
struct Output {
    SDL_Surface *pixels;
    SDL_Renderer *renderer;
    SDL_Texture *texture;
};
void flush(lv_display_t *display, const lv_area_t *area, uint8_t *bytes) {
    auto *out = static_cast<Output *>(lv_display_get_user_data(display));
    const int w = lv_area_get_width(area), h = lv_area_get_height(area);
    const int stride = lv_draw_buf_width_to_stride(w, LV_COLOR_FORMAT_RGB565);
    auto *dst = static_cast<uint8_t *>(out->pixels->pixels) + area->y1 * out->pixels->pitch + area->x1 * 2;
    for (int y = 0; y < h; y++)
        std::memcpy(dst + y * out->pixels->pitch, bytes + y * stride, w * 2);
    if (out->renderer && lv_display_flush_is_last(display)) {
        SDL_UpdateTexture(out->texture, nullptr, out->pixels->pixels, out->pixels->pitch);
        SDL_RenderCopy(out->renderer, out->texture, nullptr, nullptr);
        SDL_RenderPresent(out->renderer);
    }
    lv_display_flush_ready(display);
}
bool readBridge(uint32_t now, bool blocking) {
    char bytes[2048];
    // Limit work per animation frame when a producer has queued many updates.
    for (int chunk = 0; blocking || chunk < 8; ++chunk) {
        auto n = read(STDIN_FILENO, bytes, sizeof(bytes));
        if (n > 0)
            hemel::feedInput(bytes, size_t(n), now);
        else if (n == 0)
            return false;
        else if (errno == EINTR)
            continue;
        else if (errno == EAGAIN || errno == EWOULDBLOCK)
            break;
        else
            throw std::runtime_error(std::strerror(errno));
    }
    return true;
}
int run(Options o) {
    const bool headless = !o.output.empty();
    check(SDL_Init(headless ? SDL_INIT_TIMER : SDL_INIT_VIDEO | SDL_INIT_TIMER) == 0);
    const int w = hemel::width(), h = hemel::height();
    Output out{SDL_CreateRGBSurfaceWithFormat(0, w, h, 16, SDL_PIXELFORMAT_RGB565), nullptr, nullptr};
    check(out.pixels != nullptr);
    SDL_Window *window = nullptr;
    if (!headless) {
        window = SDL_CreateWindow("Hemel ESP32 simulator", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, w,
                                  h, SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI);
        check(window != nullptr);
        out.renderer = SDL_CreateRenderer(window, -1, 0);
        check(out.renderer != nullptr);
        SDL_RenderSetLogicalSize(out.renderer, w, h);
        out.texture =
            SDL_CreateTexture(out.renderer, SDL_PIXELFORMAT_RGB565, SDL_TEXTUREACCESS_STREAMING, w, h);
        check(out.texture != nullptr);
    }
    lv_init();
    lv_tick_set_cb(SDL_GetTicks);
    auto *display = lv_display_create(w, h);
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
    std::vector<uint8_t> stripe(lv_draw_buf_width_to_stride(w, LV_COLOR_FORMAT_RGB565) * 24);
    lv_display_set_buffers(display, stripe.data(), nullptr, stripe.size(), LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_user_data(display, &out);
    lv_display_set_flush_cb(display, flush);
    if (!hemel::attach(display))
        throw std::runtime_error("Panel profile does not match the display");
    hemel::setArrivalHandler([](hemel::Direction d) { std::fprintf(stderr, "Station entry %s\n", d == hemel::Direction::Down ? "Down" : "Up"); });
    hemel::view(o.view);
    hemel::light(o.light);
    hemel::replay(o.sample);
    uint32_t at = std::min(o.at, hemel::duration());
    uint32_t last = SDL_GetTicks();
    bool reading = o.live;
    if (o.live) {
        hemel::beginLive();
        if (headless)
            readBridge(last, true);
        else {
            const int flags = fcntl(STDIN_FILENO, F_GETFL);
            if (flags < 0 || fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK) < 0)
                throw std::runtime_error("Cannot read bridge pipe");
        }
    } else
        hemel::seek(at, last);
    lv_refr_now(display);
    for (auto p : o.taps) {
        hemel::pointer(p.x, p.y, true);
        hemel::pointer(p.x, p.y, false);
    }
    lv_refr_now(display);
    if (headless) {
        check(SDL_SaveBMP(out.pixels, o.output.c_str()) == 0);
        std::printf("%s at %.3fs, %dx%d RGB565, %zu-byte LVGL draw buffer\n", o.output.c_str(), at / 1000.0,
                    w, h, stripe.size());
    } else {
        bool running = true, paused = false;
        int speed = 1;
        while (running) {
            const uint32_t now = SDL_GetTicks();
            if (reading && !readBridge(now, false)) {
                reading = false;
                hemel::linkEnded();
            }
            if (!paused && !o.live)
                at = std::min(hemel::duration(), at + (now - last) * speed);
            last = now;
            SDL_Event e;
            while (SDL_PollEvent(&e)) {
                if (e.type == SDL_QUIT)
                    running = false;
                // SDL scales mouse coordinates to the renderer's logical size and
                // emits mouse events for the primary touch finger.
                if ((e.type == SDL_MOUSEBUTTONDOWN || e.type == SDL_MOUSEBUTTONUP) &&
                    e.button.button == SDL_BUTTON_LEFT)
                    hemel::pointer(e.button.x, e.button.y, e.type == SDL_MOUSEBUTTONDOWN);
                if (e.type == SDL_MOUSEMOTION && (e.motion.state & SDL_BUTTON_LMASK))
                    hemel::pointer(e.motion.x, e.motion.y, true);
                if (e.type != SDL_KEYDOWN || e.key.repeat)
                    continue;
                switch (e.key.keysym.sym) {
                case SDLK_ESCAPE:
                    if (!hemel::dismiss())
                        running = false;
                    break;
                case SDLK_SPACE:
                    paused = !paused;
                    if (at == hemel::duration()) {
                        at = 0;
                        paused = false;
                    }
                    break;
                case SDLK_LEFT:
                    at = at > 10000 ? at - 10000 : 0;
                    break;
                case SDLK_RIGHT:
                    at = std::min(at + 10000, hemel::duration());
                    break;
                case SDLK_1:
                case SDLK_2:
                case SDLK_3:
                    o.view = static_cast<View>(e.key.keysym.sym - SDLK_1);
                    hemel::view(o.view);
                    break;
                case SDLK_TAB:
                    if (o.live)
                        break;
                    o.sample = static_cast<Sample>((int(o.sample) + 1) % 3);
                    hemel::replay(o.sample);
                    at = 0;
                    break;
                case SDLK_t:
                    hemel::toggleLight();
                    break;
                case SDLK_f:
                    speed = speed == 1 ? 4 : speed == 4 ? 12 : 1;
                    break;
                default:
                    break;
                }
            }
            if (o.live)
                hemel::updateLive(now);
            else
                hemel::seek(at, now);
            lv_timer_handler();
            const char *names[] = {"15-mile sector", "Hemel pilot", "Watford junction"};
            char title[160];
            std::snprintf(
                title, sizeof(title), "Hemel ESP32 simulator  |  %s recording  |  %u:%02u  |  %s %dx",
                names[int(o.sample)], at / 60000, (at / 1000) % 60, paused ? "Paused" : "Replay", speed);
            SDL_SetWindowTitle(window, o.live ? "Hemel ESP32 simulator | Bridge input" : title);
            SDL_Delay(16);
        }
    }
    lv_deinit();
    SDL_FreeSurface(out.pixels);
    SDL_DestroyTexture(out.texture);
    SDL_DestroyRenderer(out.renderer);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}
} // namespace
int main(int argc, char **argv) {
    try {
        return run(parse(argc, argv));
    } catch (const std::exception &e) {
        std::fprintf(stderr, "%s\n", e.what());
        return 1;
    }
}
