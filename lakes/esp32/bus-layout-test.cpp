#include "main/bus_layout.h"
#include <cassert>

using namespace lakes::bus;

int main() {
    const Vertex east[] = {{0, 800, 0}, {2160, 800, 270}};
    const Vertex north[] = {{1080, 2000, 0}, {1080, 0, 250}};
    std::vector<Path> paths{{east, 2}, {north, 2}};
    assert(bearing(paths[0], 0) == 90 && bearing(paths[1], 250) == 0);
    assert(roofView(315) && roofView(45) && roofView(135) && roofView(205));
    assert(!roofView(314.9f) && !roofView(45.1f) && !roofView(205.1f) && !roofView(-1));

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
