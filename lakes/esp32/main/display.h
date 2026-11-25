#pragma once
#include <stdbool.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
void crowpanel_display_init(void);
uint16_t *crowpanel_back_buffer(void);
void crowpanel_present(void);
void crowpanel_prime_other_buffer(void);
uint32_t crowpanel_refresh_count(void);
bool crowpanel_touch(uint16_t *x, uint16_t *y, bool *pressed);
#ifdef __cplusplus
}
#endif
