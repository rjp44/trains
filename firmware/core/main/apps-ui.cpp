#include "core.h"
#include "directory.h"
#include "version.h"
#include <algorithm>
#include <cctype>
#include <cstdio>

namespace transport {
namespace {
lv_obj_t *body, *rows, *search, *keyboard, *storageLabel, *notice, *installedTab, *directoryTab;
bool installedOnly = true, dirty = false;
unsigned page = 0, lastRevision = 0;
std::string deleting;
constexpr unsigned pageSize = 5;
std::string sizeText(unsigned bytes) {
    char b[40];
    if (bytes >= 1024 * 1024)
        snprintf(b, sizeof b, "%.2f MiB", bytes / 1048576.0);
    else
        snprintf(b, sizeof b, "%.1f KiB", bytes / 1024.0);
    return b;
}
lv_obj_t *group(lv_obj_t *parent, lv_flex_flow_t flow) {
    auto box = lv_obj_create(parent);
    lv_obj_remove_style_all(box);
    lv_obj_set_width(box, lv_pct(100));
    lv_obj_set_height(box, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(box, flow);
    lv_obj_set_style_pad_gap(box, 8, 0);
    lv_obj_remove_flag(box, LV_OBJ_FLAG_SCROLLABLE);
    return box;
}
lv_obj_t *label(lv_obj_t *parent, const std::string &text) {
    auto obj = lv_label_create(parent);
    lv_obj_set_width(obj, lv_pct(100));
    lv_label_set_text(obj, text.c_str());
    lv_label_set_long_mode(obj, LV_LABEL_LONG_WRAP);
    return obj;
}
std::string folded(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
    return s;
}
void clicked(lv_event_t *e) {
    auto &cmd = *static_cast<std::string *>(lv_event_get_user_data(e));
    if (cmd == "installed" || cmd == "directory") {
        installedOnly = cmd == "installed";
        page = 0;
        deleting.clear();
    } else if (cmd == "next")
        ++page;
    else if (cmd == "previous" && page)
        --page;
    else if (cmd.rfind("confirm ", 0) == 0)
        deleting = cmd.substr(8);
    else if (cmd == "cancel")
        deleting.clear();
    else {
        action(cmd.c_str());
        deleting.clear();
    }
    dirty = true;
}
lv_obj_t *button(lv_obj_t *parent, const char *caption, std::string cmd, bool enabled = true) {
    auto b = lv_button_create(parent);
    lv_obj_set_height(b, 40);
    auto l = lv_label_create(b);
    lv_label_set_text(l, caption);
    lv_obj_center(l);
    auto data = new std::string(std::move(cmd));
    lv_obj_add_event_cb(b, clicked, LV_EVENT_CLICKED, data);
    lv_obj_add_event_cb(
        b, [](lv_event_t *e) { delete static_cast<std::string *>(lv_event_get_user_data(e)); },
        LV_EVENT_DELETE, data);
    if (!enabled) {
        lv_obj_add_state(b, LV_STATE_DISABLED);
        lv_obj_set_style_bg_color(b, lv_color_hex(0xd2d6d5), LV_STATE_DISABLED);
        lv_obj_set_style_text_color(l, lv_color_hex(0x535b59), 0);
        lv_obj_set_style_shadow_width(b, 0, LV_STATE_DISABLED);
    }
    return b;
}
void render() {
    auto d = directory();
    auto space = sizeText(d.free) + " free of " + sizeText(d.capacity) + " app storage";
    lv_label_set_text(storageLabel, space.c_str());
    lv_label_set_text(notice, d.message.c_str());
    lv_obj_set_state(installedTab, LV_STATE_CHECKED, installedOnly);
    lv_obj_set_state(directoryTab, LV_STATE_CHECKED, !installedOnly);
    lv_obj_clean(rows);
    if (d.updateCore)
        button(rows, ("Update firmware to " + versionLabel(d.updateCore)).c_str(), "install core", !d.busy);
    auto query = folded(lv_textarea_get_text(search));
    std::vector<const Listing *> matches;
    for (const auto &a : d.apps) {
        if (installedOnly ? !a.installed : !a.version)
            continue;
        if (!query.empty() &&
            folded(a.name + " " + a.id + " " + a.description).find(query) == std::string::npos)
            continue;
        matches.push_back(&a);
    }
    if (matches.empty()) {
        label(rows, installedOnly && query.empty()
                        ? "No apps installed. Choose Directory to download an app."
                        : "No matching applications.");
        return;
    }
    unsigned pages = (matches.size() + pageSize - 1) / pageSize;
    page = std::min(page, pages - 1);
    for (unsigned n = page * pageSize; n < matches.size() && n < (page + 1) * pageSize; ++n) {
        const auto &a = *matches[n];
        auto card = group(rows, LV_FLEX_FLOW_COLUMN);
        lv_obj_set_style_pad_ver(card, 6, 0);
        label(card, a.name + (a.id == activeApp() ? " (open)" : ""));
        if (!a.description.empty())
            label(card, a.description);
        std::string meta;
        if (a.installed)
            meta = "Installed " + versionLabel(a.installed) + " (" + sizeText(a.used) + " used)";
        if (a.version) {
            if (!meta.empty())
                meta += "   ";
            meta += versionLabel(a.version) + " download " + sizeText(a.size) + " (" +
                    sizeText((a.size + 4095u) & ~4095u) + " storage)";
        }
        label(card, meta);
        if (deleting == a.id) {
            label(card, "Delete " + a.name + " from this tablet?" +
                            (a.id == activeApp() ? " The tablet will restart in Settings." : ""));
            auto controls = group(card, LV_FLEX_FLOW_ROW_WRAP);
            button(controls, "Delete", "delete " + a.id, !d.busy);
            button(controls, "Cancel", "cancel");
            continue;
        }
        auto controls = group(card, LV_FLEX_FLOW_ROW_WRAP);
        if (a.installed && a.id != activeApp())
            button(controls, "Open", "open " + a.id, !d.busy);
        if (a.version > a.installed) {
            if (a.minCore > TRANSPORT_VERSION) {
                button(controls, a.installed ? "Update" : "Download", "install " + a.id, false);
                label(card, "Upgrade core first (requires " + versionLabel(a.minCore) + ").");
            } else if (!a.compatible)
                label(card, "Requires a newer or compatible firmware.");
            else if (!a.fits)
                label(card, "Insufficient space for this download.");
            else
                button(controls, a.installed ? "Update" : "Download", "install " + a.id, !d.busy);
        }
        if (a.installed)
            button(controls, "Delete...", "confirm " + a.id, !d.busy);
    }
    if (pages > 1) {
        label(rows, "Page " + std::to_string(page + 1) + " of " + std::to_string(pages) + " (" +
                        std::to_string(matches.size()) + " apps)");
        auto nav = group(rows, LV_FLEX_FLOW_ROW);
        button(nav, "Previous", "previous", page > 0);
        button(nav, "Next", "next", page + 1 < pages);
    }
}
} // namespace
void appsPage(lv_obj_t *parent) {
    body = parent;
    page = 0;
    deleting.clear();
    lastRevision = 0;
    dirty = true;
    installedOnly = true;
    requestDirectoryCheck();
    lv_obj_add_event_cb(body, [](lv_event_t *) { body = nullptr; }, LV_EVENT_DELETE, nullptr);
    storageLabel = label(parent, "");
    auto tabs = group(parent, LV_FLEX_FLOW_ROW_WRAP);
    installedTab = button(tabs, "Installed", "installed");
    directoryTab = button(tabs, "Directory", "directory");
    button(tabs, "Refresh", "check");
    search = lv_textarea_create(parent);
    lv_obj_set_width(search, lv_pct(100));
    lv_textarea_set_one_line(search, true);
    lv_textarea_set_max_length(search, 80);
    lv_textarea_set_placeholder_text(search, "Search apps by name or description");
    keyboard = lv_keyboard_create(parent);
    lv_obj_set_size(keyboard, lv_pct(100), 185);
    lv_keyboard_set_textarea(keyboard, search);
    lv_obj_add_flag(keyboard, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_event_cb(
        search, [](lv_event_t *) { lv_obj_remove_flag(keyboard, LV_OBJ_FLAG_HIDDEN); }, LV_EVENT_CLICKED,
        nullptr);
    lv_obj_add_event_cb(
        search,
        [](lv_event_t *) {
            page = 0;
            dirty = true;
        },
        LV_EVENT_VALUE_CHANGED, nullptr);
    auto hide = [](lv_event_t *) { lv_obj_add_flag(keyboard, LV_OBJ_FLAG_HIDDEN); };
    lv_obj_add_event_cb(keyboard, hide, LV_EVENT_READY, nullptr);
    lv_obj_add_event_cb(keyboard, hide, LV_EVENT_CANCEL, nullptr);
    notice = label(parent, "");
    rows = group(parent, LV_FLEX_FLOW_COLUMN);
    render();
}
void pollApps() {
    pollDirectoryCheck();
    if (!body)
        return;
    auto rev = directoryRevision();
    if (dirty || rev != lastRevision) {
        dirty = false;
        lastRevision = rev;
        render();
    }
}
void aboutPage(lv_obj_t *parent) {
    label(parent, installedVersions());
    label(parent, "created by rjp44");
    constexpr char link[] = "https://github.com/rjp44/trains";
    label(parent, link);
    auto qr = lv_qrcode_create(parent);
    lv_qrcode_set_size(qr, 124);
    lv_obj_set_style_border_width(qr, 8, 0);
    lv_obj_set_style_border_color(qr, lv_color_white(), 0);
    lv_qrcode_update(qr, link, sizeof link - 1);
    label(parent, "Data sources");
    label(parent, "Sunrise and sunset: Open-Meteo (open-meteo.com).");
    auto credits = sourceCredits();
    if (!credits.empty())
        label(parent, credits);
    else
        label(parent, "Hemel uses Network Rail, Signal Maps, Railinfo, Open Rail and EASMData. Lakes uses "
                      "OpenStreetMap, OpenFreeMap, OpenMapTiles, Mapzen, BODS and Railinfo.");
}
} // namespace transport
