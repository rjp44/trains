#pragma once
#include "lvgl.h"
namespace panel {
// Use from the app's display thread.
void openSettings(void (*onClose)(), const char *stopsLabel);
void setAppsPage(void (*draw)(lv_obj_t*));
bool settingsOpen();
void pollSettings();
} // namespace panel
