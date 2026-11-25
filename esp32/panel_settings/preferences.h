#pragma once
#include <cstdint>

namespace panel {
enum class Sound : uint8_t { Off, Stops, All };
void loadPreferences();
bool savePreferences();
Sound sound();
unsigned volume();
unsigned brightness();
void setSound(Sound value);
void setVolume(unsigned value);
bool setBrightness(unsigned value);
void startBacklight();
void hornInit();
void trainHorn(bool down, bool bookedStop);
} // namespace panel
