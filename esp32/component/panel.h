#pragma once
#include "lvgl.h"
#include <cstdint>
#include <cstddef>

// Call on the LVGL thread. The attached display must match the generated profile.
namespace hemel {
enum class View { Sector, Hemel, Watford };
enum class Sample { Sector, Hemel, Watford };
int width();
int height();
bool attach(lv_display_t *display);
void view(View value);
void light(bool enabled);
void replay(Sample value);
uint32_t duration();
// The second clock drives opposing cards independently of replay pause, speed and seek.
void seek(uint32_t position_ms, uint32_t wall_ms);
void pointer(int x, int y, bool down);
bool dismiss();
void toggleLight();
void beginLive();
bool isLive();
void feedInput(const char *bytes, size_t length, uint32_t wall_ms);
void updateLive(uint32_t wall_ms);
void linkEnded();
void refreshCards(uint32_t wall_ms);
} // namespace hemel
