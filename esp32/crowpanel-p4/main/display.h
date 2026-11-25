#pragma once
#include "lvgl.h"

#ifdef __cplusplus
extern "C" {
#endif
lv_display_t *crowpanel_display_init(void);
void crowpanel_backlight_on(void);
#ifdef __cplusplus
}
#endif
