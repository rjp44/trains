#pragma once
#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>

namespace transport {
constexpr size_t maxPackage = 65536;
struct Track {
    std::string id, name, direction;
    int y;
};
struct Berth {
    std::string id, track;
    int offset;
    std::string stage, context;
};
struct Observation {
    uint32_t at;
    std::string berth;
    unsigned matched;
    std::string timing;
};
struct Box {
    int x, y, width, height;
};
struct Package {
    std::string app, version, stationId, stationName, service, head, route, booked;
    int x;
    Box card;
    std::vector<Track> tracks;
    std::vector<Berth> berths;
    std::vector<Observation> frames;
};
// On failure the currently mounted package remains usable.
bool mount(const uint8_t *bytes, size_t size, Package &active);
struct State {
    const Observation *frame;
    const Berth *berth;
    const Track *track;
    bool card;
    int entryMs; // Last station entry up to this cursor. Silent during replay.
    std::string entryDirection;
    bool bookedEntry;
};
State seek(const Package &p, uint32_t ms);
struct Painter {
    void (*rect)(int x, int y, int w, int h, unsigned rgb);
    void (*text)(int x, int y, const std::string &s, unsigned rgb, int width);
};
void draw(const Package &p, const State &s, Painter paint);
} // namespace transport
