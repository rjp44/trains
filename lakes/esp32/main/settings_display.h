#pragma once
#include <cstdint>
namespace lakes {
void openPanelSettings(bool portrait);
void settingsPointer(uint16_t px, uint16_t py, bool pressed);
void updatePanelSettings();
const uint16_t *settingsFrame();
} // namespace lakes
