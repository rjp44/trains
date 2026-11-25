#pragma once
#include <cstdint>
#include <cstddef>
#include <string_view>

namespace hemel::input {
using Field = std::string_view;
uint32_t fingerprint();
unsigned markers();
void startFrame(bool full);
void marker(unsigned index, unsigned aspect, unsigned kind, const Field *text);
void card(unsigned slot, const Field *text, uint32_t identity);
void finishFrame(unsigned status, uint32_t observed, uint32_t now);
void stale();
void forgetSequence();
} // namespace hemel::input
