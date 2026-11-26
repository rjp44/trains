#pragma once
#include <cstdint>

namespace lakes {
void drawOverlay(uint16_t *target);
bool benchmarkTerrain();
unsigned httpsActivity(); // Odd during a request, incremented on both edges.
} // namespace lakes
