#pragma once
#include "lvgl.h"
namespace transport {
void initAppearance(bool lakes);
void appearanceOptions(lv_obj_t *parent);
void toggleAppearance();
void pollAppearance();
} // namespace transport
