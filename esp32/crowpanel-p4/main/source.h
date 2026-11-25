#pragma once
#include <cstddef>
#include <cstdint>
// All three functions run with the LVGL port lock held.
void usb_input(const char *bytes, size_t length, uint32_t now);
bool wifi_needs_snapshot();
void wifi_packet(const char *bytes, size_t length, uint32_t now);
