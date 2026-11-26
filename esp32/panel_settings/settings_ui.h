#pragma once
#include "lvgl.h"
namespace panel {
// Use from the app's display thread.
void openSettings(void (*onClose)(), const char *stopsLabel);
void setAppPage(const char *name, void (*draw)(lv_obj_t *));
lv_obj_t *optionRow(lv_obj_t *parent, const char *title);
void option(lv_obj_t *row, const char *name, lv_event_cb_t click, uintptr_t id, bool selected = false);
void refreshAppPage();
void setAppsPage(void (*draw)(lv_obj_t*));
void setAboutPage(void (*draw)(lv_obj_t*));
bool settingsOpen();
void pollSettings();
} // namespace panel
