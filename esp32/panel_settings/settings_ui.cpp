#include "settings_ui.h"
#include "preferences.h"
#include "wifi.h"
#include <algorithm>
#include <string>

namespace panel {
namespace {
enum class Page { Wifi, Sound, Display };
Page page;
lv_obj_t *overlay, *content, *kbd, *ssidInput, *password, *notice;
lv_obj_t *levelLabel;
void (*closed)();
const char *stopName;
std::string selected;
WifiStatus network;
size_t first = 0;
bool editing, hidden;
constexpr size_t perPage = 5;
const auto ink = lv_color_hex(0x183b36), accent = lv_color_hex(0x236b59);
void render();

lv_obj_t *group(lv_obj_t *parent, lv_flex_flow_t flow) {
    auto *obj = lv_obj_create(parent);
    lv_obj_remove_style_all(obj);
    lv_obj_set_size(obj, lv_pct(100), LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(obj, flow);
    lv_obj_set_style_pad_gap(obj, 8, 0);
    lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
    return obj;
}
lv_obj_t *label(lv_obj_t *parent, const char *value) {
    auto *obj = lv_label_create(parent);
    lv_label_set_text(obj, value);
    lv_obj_set_style_text_color(obj, ink, 0);
    return obj;
}
lv_obj_t *button(lv_obj_t *parent, const char *name, lv_event_cb_t cb, uintptr_t value = 0,
                 bool active = false) {
    auto *b = lv_button_create(parent);
    lv_obj_set_height(b, 42);
    lv_obj_set_style_bg_color(b, active ? accent : lv_color_hex(0xdce9e1), 0);
    lv_obj_set_style_shadow_width(b, 0, 0);
    auto *txt = lv_label_create(b);
    lv_label_set_text(txt, name);
    lv_obj_set_style_text_color(txt, active ? lv_color_white() : ink, 0);
    lv_obj_center(txt);
    lv_obj_add_event_cb(b, cb, LV_EVENT_CLICKED, reinterpret_cast<void *>(value));
    return b;
}
uintptr_t value(lv_event_t *e) { return reinterpret_cast<uintptr_t>(lv_event_get_user_data(e)); }
void finish(lv_event_t *) {
    lv_obj_delete(overlay);
    overlay = content = kbd = ssidInput = password = notice = nullptr;
    selected.clear();
    if (closed)
        closed();
}
void visit(lv_event_t *e) {
    page = Page(value(e));
    editing = false;
    selected.clear();
    if (page == Page::Wifi && wifi_status().networks.empty())
        wifi_scan();
    render();
}
void submit(lv_event_t *) {
    const std::string ssid = hidden ? lv_textarea_get_text(ssidInput) : selected;
    const std::string pass = lv_textarea_get_text(password);
    if (ssid.empty() || ssid.size() > 32) {
        lv_label_set_text(notice, "Enter a network name of 1 to 32 bytes.");
        return;
    }
    if (pass.size() > 64) {
        lv_label_set_text(notice, "The password is too long.");
        return;
    }
    if (!wifi_join(ssid, pass)) {
        lv_label_set_text(notice, "Wi-Fi is busy. Try again.");
        return;
    }
    editing = false;
    selected.clear();
    render();
}
void keyDone(lv_event_t *e) {
    if (hidden && lv_keyboard_get_textarea(kbd) == ssidInput)
        lv_keyboard_set_textarea(kbd, password);
    else
        submit(e);
}
lv_obj_t *field(const char *name, bool secret) {
    auto *row = group(content, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(row, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    auto *title = label(row, name);
    lv_obj_set_width(title, 112);
    auto *input = lv_textarea_create(row);
    lv_textarea_set_one_line(input, true);
    lv_textarea_set_max_length(input, secret ? 64 : 32);
    if (secret) {
        lv_textarea_set_password_mode(input, true);
        lv_textarea_set_password_show_time(input, 0);
    }
    lv_obj_set_flex_grow(input, 1);
    lv_obj_add_event_cb(
        input,
        [](lv_event_t *e) {
            lv_keyboard_set_textarea(kbd, static_cast<lv_obj_t *>(lv_event_get_target(e)));
        },
        LV_EVENT_CLICKED, nullptr);
    return input;
}
void fullSymbolKeyboard(lv_obj_t *keyboard) {
    // The stock LVGL symbols page omits four printable password characters.
    static const char *map[] = {"1",
                                "2",
                                "3",
                                "4",
                                "5",
                                "6",
                                "7",
                                "8",
                                "9",
                                "0",
                                LV_SYMBOL_BACKSPACE,
                                "\n",
                                "abc",
                                "+",
                                "&",
                                "/",
                                "*",
                                "=",
                                "%",
                                "!",
                                "?",
                                "#",
                                "<",
                                ">",
                                "\n",
                                "\\",
                                "@",
                                "$",
                                "(",
                                ")",
                                "{",
                                "}",
                                "[",
                                "]",
                                ";",
                                "\"",
                                "'",
                                "\n",
                                "^",
                                "~",
                                "|",
                                "`",
                                "_",
                                "-",
                                ":",
                                ".",
                                ",",
                                LV_SYMBOL_LEFT,
                                " ",
                                LV_SYMBOL_RIGHT,
                                LV_SYMBOL_OK,
                                ""};
    static lv_buttonmatrix_ctrl_t controls[sizeof(map) / sizeof(*map)];
    std::fill_n(controls, sizeof(controls) / sizeof(*controls), static_cast<lv_buttonmatrix_ctrl_t>(1));
    lv_keyboard_set_map(keyboard, LV_KEYBOARD_MODE_SPECIAL, map, controls);
}
void form() {
    if (hidden)
        ssidInput = field("Network name", false);
    else
        label(content, selected.c_str());
    password = field("Password", true);
    auto *row = group(content, LV_FLEX_FLOW_ROW);
    button(row, "Back", [](lv_event_t *) {
        editing = false;
        selected.clear();
        render();
    });
    button(row, "Connect", submit, 0, true);
    notice = label(row, "");
    lv_obj_set_flex_grow(notice, 1);
    kbd = lv_keyboard_create(content);
    lv_obj_set_size(kbd, lv_pct(100), lv_pct(48));
    fullSymbolKeyboard(kbd);
    lv_keyboard_set_textarea(kbd, hidden ? ssidInput : password);
    lv_obj_add_event_cb(kbd, keyDone, LV_EVENT_READY, nullptr);
    lv_obj_add_event_cb(
        kbd,
        [](lv_event_t *) {
            editing = false;
            render();
        },
        LV_EVENT_CANCEL, nullptr);
}
void choose(lv_event_t *e) {
    size_t i = value(e);
    hidden = i >= network.networks.size();
    selected = hidden ? "" : network.networks[i].ssid;
    if (!hidden && !network.networks[i].secured) {
        wifi_join(selected, "");
    } else
        editing = true;
    render();
}
void networks() {
    network = wifi_status();
    if (first >= network.networks.size())
        first = 0;
    label(content, network.message.empty() ? "Wi-Fi" : network.message.c_str());
    auto *actions = group(content, LV_FLEX_FLOW_ROW);
    auto *scan = button(actions, "Scan", [](lv_event_t *) {
        wifi_scan();
        render();
    });
    auto *manual = button(actions, "Hidden network", choose, network.networks.size());
    if (network.busy) {
        lv_obj_add_state(scan, LV_STATE_DISABLED);
        lv_obj_add_state(manual, LV_STATE_DISABLED);
    }
    if (first)
        button(actions, "Previous", [](lv_event_t *) {
            first -= perPage;
            render();
        });
    if (first + perPage < network.networks.size())
        button(actions, "Next", [](lv_event_t *) {
            first += perPage;
            render();
        });
    for (size_t i = first; i < std::min(first + perPage, network.networks.size()); ++i) {
        auto *b = button(content, network.networks[i].ssid.c_str(), choose, i);
        lv_obj_set_width(b, lv_pct(100));
        if (network.busy)
            lv_obj_add_state(b, LV_STATE_DISABLED);
    }
}
void levelText(int n) {
    lv_label_set_text_fmt(levelLabel, "%s   %d%%", page == Page::Sound ? "Volume" : "Brightness", n);
}
void save() {
    if (!savePreferences())
        lv_label_set_text(notice, "Could not save settings.");
}
void soundOrDisplay() {
    if (page == Page::Sound) {
        const char *names[] = {"Off", stopName, "All trains"};
        auto *row = group(content, LV_FLEX_FLOW_ROW_WRAP);
        for (unsigned i = 0; i < 3; ++i)
            button(
                row, names[i],
                [](lv_event_t *e) {
                    setSound(Sound(value(e)));
                    render();
                    save();
                },
                i, unsigned(sound()) == i);
    }
    int n = page == Page::Sound ? volume() : brightness();
    levelLabel = label(content, "");
    lv_obj_set_style_pad_top(levelLabel, 20, 0);
    levelText(n);
    auto *slider = lv_slider_create(content);
    lv_obj_set_size(slider, lv_pct(92), 26);
    lv_obj_set_style_margin_all(slider, 14, 0);
    lv_obj_set_style_bg_color(slider, accent, LV_PART_INDICATOR);
    lv_slider_set_range(slider, page == Page::Sound ? 0 : 10, 100);
    lv_slider_set_value(slider, n, LV_ANIM_OFF);
    notice = label(content, "");
    lv_obj_add_event_cb(
        slider,
        [](lv_event_t *e) {
            int n = lv_slider_get_value(static_cast<lv_obj_t *>(lv_event_get_target(e)));
            if (page == Page::Sound)
                setVolume(n);
            else if (!setBrightness(n)) {
                lv_label_set_text(notice, "Backlight control unavailable.");
                return;
            }
            levelText(n);
        },
        LV_EVENT_VALUE_CHANGED, nullptr);
    lv_obj_add_event_cb(slider, [](lv_event_t *) { save(); }, LV_EVENT_RELEASED, nullptr);
}
void render() {
    lv_obj_clean(overlay);
    kbd = ssidInput = password = notice = nullptr;
    auto *header = group(overlay, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(header, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    label(header, "Settings");
    button(header, "Done", finish);
    auto *nav = group(overlay, LV_FLEX_FLOW_ROW);
    const char *names[] = {"Wi-Fi", "Sound", "Display"};
    for (unsigned i = 0; i < 3; ++i)
        button(nav, names[i], visit, i, unsigned(page) == i);
    content = group(overlay, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_grow(content, 1);
    lv_obj_add_flag(content, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(content, LV_DIR_VER);
    if (page != Page::Wifi)
        soundOrDisplay();
    else if (editing)
        form();
    else
        networks();
}
} // namespace
bool settingsOpen() { return overlay != nullptr; }
void openSettings(void (*onClose)(), const char *stopsLabel) {
    if (overlay)
        return;
    closed = onClose;
    stopName = stopsLabel;
    editing = false;
    first = 0;
    hidden = false;
    page = Page::Wifi;
    overlay = lv_obj_create(lv_layer_top());
    lv_obj_set_size(overlay, lv_pct(100), lv_pct(100));
    lv_obj_set_style_radius(overlay, 0, 0);
    lv_obj_set_style_border_width(overlay, 0, 0);
    lv_obj_set_style_bg_color(overlay, lv_color_hex(0xf4f7f1), 0);
    lv_obj_set_style_bg_opa(overlay, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(overlay, 20, 0);
    lv_obj_set_flex_flow(overlay, LV_FLEX_FLOW_COLUMN);
    lv_obj_remove_flag(overlay, LV_OBJ_FLAG_SCROLLABLE);
    wifi_scan();
    render();
}
void pollSettings() {
    if (overlay && page == Page::Wifi && !editing && network.revision != wifi_revision())
        render();
}
} // namespace panel
