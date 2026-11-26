#pragma once
#include <cstddef>
#include <cstdint>
// Calls run under the display lock.
void setManualReplay(bool enabled);
bool wifi_needs_snapshot();
void wifi_packet(const char *bytes, size_t length, uint32_t now);
