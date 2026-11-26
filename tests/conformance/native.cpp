// Host entry point for exactly the decoder, replay clock and drawing code linked on the P4.
#include "../../firmware/player/replay.h"
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <vector>

int main(int argc, char **argv) {
    if (argc < 2)
        return 2;
    std::ifstream input(argv[1], std::ios::binary);
    std::vector<uint8_t> bytes{std::istreambuf_iterator<char>(input), {}};
    transport::Package p;
    if (!transport::mount(bytes.data(), bytes.size(), p))
        return 1;
    // A rejected replacement must preserve the already mounted scene.
    if (transport::mount(bytes.data(), bytes.size() - 1, p))
        return 1;
    for (int i = 2; i < argc; ++i) {
        auto s = transport::seek(p, std::strtoul(argv[i], nullptr, 10));
        std::printf("F\t%s\t%d\t%d\t%s\t%d\t%s\t%d\n", s.berth ? s.berth->id.c_str() : "-",
                    s.berth ? p.x + s.berth->offset : -1, s.track ? s.track->y : -1,
                    s.card && s.frame->matched ? p.service.c_str() : "-", s.entryMs,
                    s.entryMs < 0 ? "-" : s.entryDirection.c_str(), s.bookedEntry);
        transport::draw(p, s,
                        {[](int x, int y, int w, int h, unsigned rgb) {
                             std::printf("R\t%d\t%d\t%d\t%d\t#%06x\n", x, y, w, h, rgb);
                         },
                         [](int x, int y, const std::string &str, unsigned rgb, int w) {
                             std::printf("T\t%d\t%d\t%s\t#%06x\t%d\n", x, y, str.c_str(), rgb, w);
                         }});
    }
}
