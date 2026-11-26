#pragma once
#include <stdbool.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
void crowpanel_display_init(void);
uint16_t *crowpanel_back_buffer(void);
const uint16_t *crowpanel_front_buffer(void);
void crowpanel_present(void);
void crowpanel_prime_other_buffer(void);
uint32_t crowpanel_refresh_count(void);
typedef struct { uint16_t x, y; } TouchPoint;
typedef struct { uint8_t count; TouchPoint points[2]; } TouchFrame;
bool crowpanel_touch(TouchFrame *frame);
uint8_t crowpanel_touch_capacity(void);
#ifdef __cplusplus
}
#endif
