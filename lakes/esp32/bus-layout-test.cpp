#include "main/bus_layout.h"
#include <cassert>

using namespace lakes::bus;

int main() {
    const Vertex east[] = {{0, 800, 0}, {2160, 800, 270}};
    const Vertex north[] = {{1080, 2000, 0}, {1080, 0, 250}};
    std::vector<Path> paths{{east, 2}, {north, 2}};
    assert(bearing(paths[0], 0) == 90 && bearing(paths[1], 250) == 0);
    for (float axis : {0.f, 180.f})
        for (float sign : {-1.f, 1.f}) {
            auto view = [&](float offset) { return busView(std::fmod(360 + axis + sign * offset, 360.f)); };
            assert(view(0) == View::Roof && view(22.5f) == View::Roof);
            assert(view(22.51f) == View::Oblique && view(45) == View::Oblique && view(67.49f) == View::Oblique);
            assert(view(67.5f) == View::Side && view(90) == View::Side);
        }
    assert(busView(360) == View::Roof && busView(-1) == View::Front && busView(NAN) == View::Front);
    for (int heading = 0; heading <= 360; ++heading) {
        assert(busView(heading, 7) == View::Side);
        bool oldRoof = heading >= 315 || heading <= 45 || (heading >= 135 && heading <= 205);
        assert(busView(heading, 10) == (oldRoof ? View::Roof : View::Side));
    }

    const Vertex zigzag[] = {{0, 96, 0}, {0, 8, 11}, {8, 8, 12}, {8, 0, 13}, {0, 0, 14}, {0, -96, 26}};
    const Path path{zigzag, 6};
    auto middle = nearest(path, {1, .5f}, -1);
    assert(middle.distance == 12.5f && bearing(path, middle.distance) == 0);

    std::vector<Marker> markers{{0, {135, 100}, 90, -1, 0},
                                {1, {134, 100}, 90, 0, 134},
                                {2, {135, 100}, 90, 0, 135},
                                {3, {136, 100}, 90, 0, 136},
                                {4, {135, 101}, 0, 1, 149}};
    std::vector<Box> occupied;
    for (auto &m : markers) {
        bool fits = place(m, paths, occupied, 1.f, [](Point) { return true; });
        assert(fits);
        occupied.push_back(m.box);
    }
    restoreOrder(markers);
    assert(markers[0].point.x == 135 && markers[0].point.y == 100);
    assert(markers[1].point.x < markers[2].point.x && markers[2].point.x < markers[3].point.x);
    for (unsigned i = 0; i < markers.size(); ++i) {
        assert(markers[i].index == i);
        if (markers[i].path == 0)
            assert(markers[i].point.y == 100);
        if (markers[i].path == 1)
            assert(markers[i].point.x == 135);
        for (unsigned j = 0; j < i; ++j)
            assert(overlap(markers[i].box, markers[j].box) == 0);
    }
}
