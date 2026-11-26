// Exercise the real touchscreen widgets without storing or transmitting any credentials.
#include "settings_ui.h"
#include "preferences.h"
#include "wifi.h"
#include <cassert>
#include <cstring>
#include <string>
#include <vector>

namespace {
WifiStatus networks{"Choose a network.", {{"Test secured", true}, {"Test open", false}}, false, 1};
std::string joined, key;
panel::Sound mode = panel::Sound::All;
unsigned light = 100, gain = 100, saves = 0;
bool closed;
unsigned scans;
lv_obj_t *find(lv_obj_t *parent, const lv_obj_class_t *type, const char *name = nullptr) {
    if (lv_obj_check_type(parent, type) && (!name || !strcmp(lv_label_get_text(parent), name)))
        return parent;
    for (unsigned i = 0; i < lv_obj_get_child_count(parent); ++i)
        if (auto *obj = find(lv_obj_get_child(parent, i), type, name))
            return obj;
    return nullptr;
}
lv_obj_t *named(const char *s) { return find(lv_layer_top(), &lv_label_class, s); }
lv_indev_data_t pointer{};
lv_indev_t *input;
void tap(const char *name) {
    auto *txt = named(name);
    assert(txt);
    auto *b = lv_obj_get_parent(txt);
    lv_obj_update_layout(b);
    lv_area_t area;
    lv_obj_get_coords(b, &area);
    pointer.point = {(area.x1 + area.x2) / 2, (area.y1 + area.y2) / 2};
    assert(pointer.point.y >= 0 && pointer.point.y < lv_display_get_vertical_resolution(nullptr));
    pointer.state = LV_INDEV_STATE_PRESSED;
    lv_indev_read(input);
    pointer.state = LV_INDEV_STATE_RELEASED;
    lv_indev_read(input);
}
void exercise(int width, int height) {
    lv_display_set_resolution(lv_display_get_default(), width, height);
    closed = false;
    panel::setAppPage([](lv_obj_t *parent) { panel::optionRow(parent, "View"); });
    panel::setAppsPage([](lv_obj_t *) {});
    panel::setAboutPage([](lv_obj_t *) {});
    unsigned previousScans = scans;
    panel::openSettings([] { closed = true; }, "Stopping trains only");
    assert(named("View") && !named("Hidden network") && scans == previousScans);
    auto *tab = lv_obj_get_parent(named("App"));
    auto *nav = lv_obj_get_parent(tab);
    assert(lv_obj_get_child(nav, 0) == tab);
    const char *tabs[] = {"App", "Downloads", "Sound", "Display", "Wi-Fi", "About"};
    for (int i = 0; i < 6; ++i)
        assert(lv_obj_get_child(nav, i) == lv_obj_get_parent(named(tabs[i])));
    tap("Wi-Fi");
    tap("Hidden network");
    auto *keyboard = find(lv_layer_top(), &lv_keyboard_class);
    assert(keyboard);
    auto *ssid = lv_keyboard_get_textarea(keyboard);
    lv_textarea_set_text(ssid, "Unlisted SSID");
    lv_obj_send_event(keyboard, LV_EVENT_READY, nullptr);
    auto *password = lv_keyboard_get_textarea(keyboard);
    assert(password != ssid && lv_textarea_get_password_mode(password));
    lv_keyboard_set_mode(keyboard, LV_KEYBOARD_MODE_SPECIAL);
    for (const char *symbol : {"~", "^", "|", "`"}) {
        unsigned i = 0;
        while (const char *text = lv_buttonmatrix_get_button_text(keyboard, i)) {
            if (!strcmp(text, symbol)) break;
            ++i;
        }
        assert(lv_buttonmatrix_get_button_text(keyboard, i));
        lv_buttonmatrix_set_selected_button(keyboard, i);
        lv_obj_send_event(keyboard, LV_EVENT_VALUE_CHANGED, nullptr);
    }
    assert(!strcmp(lv_textarea_get_text(password), "~^|`"));
    ++networks.revision;
    panel::pollSettings();
    assert(lv_keyboard_get_textarea(keyboard) == password);
    lv_textarea_set_text(password, "test-fixture");
    tap("Connect");
    assert(joined == "Unlisted SSID" && key == "test-fixture");
    tap("Test secured");
    keyboard = find(lv_layer_top(), &lv_keyboard_class);
    assert(lv_textarea_get_password_mode(lv_keyboard_get_textarea(keyboard)));
    tap("Back");
    tap("Test open");
    assert(joined == "Test open" && key.empty());
    tap("Sound");
    for (const char *s : {"Off", "Stopping trains only", "All trains"}) {
        tap(s);
        assert(mode == (!strcmp(s, "Off")          ? panel::Sound::Off
                        : !strcmp(s, "All trains") ? panel::Sound::All
                                                   : panel::Sound::Stops));
    }
    auto adjust = [](int n) {
        auto *slider = find(lv_layer_top(), &lv_slider_class);
        assert(slider);
        lv_slider_set_value(slider, n, LV_ANIM_OFF);
        lv_obj_send_event(slider, LV_EVENT_VALUE_CHANGED, nullptr);
        lv_obj_send_event(slider, LV_EVENT_RELEASED, nullptr);
    };
    adjust(45);
    assert(gain == 45);
    tap("Display");
    adjust(70);
    assert(light == 70);
    tap("Done");
    assert(closed && !panel::settingsOpen());
}
} // namespace
WifiStatus wifi_status() { return networks; }
unsigned wifi_revision() { return networks.revision; }
bool wifi_scan() { ++scans; return true; }
bool wifi_join(std::string_view s, std::string_view p) {
    joined = s;
    key = p;
    return true;
}
namespace panel {
Sound sound() { return mode; }
unsigned brightness() { return light; }
unsigned volume() { return gain; }
void setSound(Sound s) { mode = s; }
void setVolume(unsigned n) { gain = n; }
bool setBrightness(unsigned n) {
    light = n;
    return true;
}
bool savePreferences() {
    ++saves;
    return true;
}
} // namespace panel
int main() {
    lv_init();
    auto *d = lv_display_create(1024, 600);
    static std::vector<uint16_t> buffer(1024 * 600);
    lv_display_set_color_format(d, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(d, buffer.data(), nullptr, buffer.size() * 2, LV_DISPLAY_RENDER_MODE_FULL);
    lv_display_set_flush_cb(
        d, [](lv_display_t *d, const lv_area_t *, uint8_t *) { lv_display_flush_ready(d); });
    input = lv_indev_create();
    lv_indev_set_type(input, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(input, [](lv_indev_t *, lv_indev_data_t *p) {
        p->point = pointer.point;
        p->state = pointer.state;
    });
    exercise(1024, 600);
    exercise(600, 1024);
    assert(saves == 10);
}
