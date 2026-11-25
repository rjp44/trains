#include "horn_pcm.h"
#include <array>
#include <cstdio>
#include <cstdlib>
#include <string_view>

int main(int argc, char **argv) {
    std::array<int16_t, horn::frames * 2> down{}, up{};
    horn::render(hemel::Direction::Down, 0, horn::frames, down.data());
    horn::render(hemel::Direction::Up, 0, horn::frames, up.data());
    unsigned highCrossings = 0, lowCrossings = 0;
    int peak = 0;
    for (unsigned i = 0; i < horn::frames; ++i) {
        int left = down[2*i], right = down[2*i+1];
        if (left != up[2*i+1] || right != up[2*i]) return 1;
        if (i >= horn::highFrames && left) return 1;
        if ((i < horn::highFrames + horn::gap || i >= horn::highFrames + horn::gap + horn::lowFrames) && right) return 1;
        if (i && left > 0 && down[2*i-2] <= 0) ++highCrossings;
        if (i && right > 0 && down[2*i-1] <= 0) ++lowCrossings;
        peak = std::max({peak, std::abs(left), std::abs(right)});
    }
    if (peak < 2500 || peak > 3200 || highCrossings != 111 || lowCrossings != 89) return 1;
    std::fprintf(stderr, "Down and Up stereo slots verified, peak %d/32768\n", peak);
    if (argc == 2) {
        const auto &pcm = std::string_view(argv[1]) == "up" ? up : down;
        return std::fwrite(pcm.data(), sizeof(int16_t), pcm.size(), stdout) != pcm.size();
    }
    return 0;
}
