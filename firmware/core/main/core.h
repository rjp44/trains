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
const char *activeAdapter();
void aboutPage(lv_obj_t* parent);
std::string status();
void action(const char *command);
void appsPage(lv_obj_t *parent);
void pollApps();
} // namespace transport
namespace lakes {
bool portraitView();
void drawOptions(lv_obj_t *);
lv_display_t *coreDisplay(bool landscapeApp, bool schematic);
} // namespace lakes
