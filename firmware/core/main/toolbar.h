#pragma once
#include <cstdint>

namespace transport {
constexpr int toolbarHeight = 52;
enum class ToolbarButton { None, Settings, Theme };
ToolbarButton toolbarButton(int x, int y, int width);
void drawToolbar(uint16_t *pixels, bool portrait, bool dark);
} // namespace transport
