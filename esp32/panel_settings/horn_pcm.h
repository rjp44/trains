#pragma once
#include "direction.h"
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace horn {
constexpr unsigned rate = 16000;
constexpr unsigned highFrames = rate * 650 / 1000;
constexpr unsigned gap = rate * 140 / 1000;
constexpr unsigned lowFrames = rate * 800 / 1000;
// The quiet tail drains more than the four 128-frame DMA buffers before mute.
constexpr unsigned frames = highFrames + gap + lowFrames + 1024;
inline void render(hemel::Direction direction, unsigned start, unsigned count, int16_t *stereo) {
    for (unsigned i = 0; i < count; ++i) {
        const unsigned frame = start + i;
        const bool high = frame < highFrames;
        const bool low = frame >= highFrames + gap && frame < highFrames + gap + lowFrames;
        int16_t left = 0, right = 0;
        if (high || low) {
            const unsigned pos = high ? frame : frame - highFrames - gap;
            const unsigned len = high ? highFrames : lowFrames;
            const float envelope = std::min({1.0f, pos / 192.0f, (len - 1 - pos) / 192.0f});
            const float phase = 6.2831853f * (high ? 554 : 370) * pos / rate;
            const auto value =
                static_cast<int16_t>(envelope * (2700 * sinf(phase) + 500 * sinf(phase * 2)));
            if (high == (direction == hemel::Direction::Down))
                left = value;
            else
                right = value;
        }
        stereo[2 * i] = left;
        stereo[2 * i + 1] = right;
    }
}
} // namespace horn
