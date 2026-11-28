#pragma once
#include "settings_ui.h"
#include <string>
namespace transport {
inline void watchPicker(lv_obj_t *parent, const std::string &names, unsigned selected, lv_event_cb_t changed) {
    auto dropdown = lv_dropdown_create(panel::optionRow(parent, "Watch station"));
    lv_obj_set_width(dropdown, 260);
    lv_dropdown_set_options(dropdown, names.c_str());
    lv_dropdown_set_selected(dropdown, selected);
    lv_obj_add_event_cb(dropdown, changed, LV_EVENT_VALUE_CHANGED, nullptr);
}
}
