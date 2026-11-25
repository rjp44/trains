#pragma once
#include "lvgl.h"
namespace panel {
// Use from the app's display thread.
void openSettings(void (*onClose)(), const char *stopsLabel);
bool settingsOpen();
void pollSettings();
} // namespace panel
