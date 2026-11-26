#pragma once
#include "lvgl.h"
#include <string>
namespace transport {
void lockDisplay();
void unlockDisplay();
void storageInit();
bool mount();
void validated();
void failedBoot();
const char *activeApp();
std::string status();
void action(const char *command);
void appsPage(lv_obj_t *parent);
void pollApps();
} // namespace transport
namespace lakes {
bool portraitView();
lv_display_t *coreDisplay(bool landscapeApp);
} // namespace lakes
