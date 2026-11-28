#include "../../firmware/core/main/rail-spacing.h"
#include <cassert>

int main() {
    rail::Axis axis;
    std::vector<rail::Gap> gaps{{50, 400, 32}, {400, 450, 20}};
    std::vector<rail::Footprint> boxes{
        {50, -25, 25, 10, 32}, {400, -35, 35, 12, 30},
        {400, -10, 10, 40, 60}, {450, -35, 35, 41, 55}
    };
    axis.build(1024, 200, boxes, gaps);
    axis.setZoom(0);
    assert(axis.width() == 200);
    for (float zoom : {0.f, 0.6f, 1.f, 3.f}) {
        axis.setZoom(zoom);
        assert(axis.project(400) - axis.project(50) >= 64);
        assert(axis.project(450) - axis.project(400) >= 49);
        for (int x = 0; x <= 1024; ++x)
            assert(std::abs(axis.unproject(axis.project(x)) - x) < 0.01f);
    }

    // A crowded line sets a floor above the viewport width.
    boxes = {{50, -63, 63, 20, 40}, {400, -63, 63, 20, 40}};
    gaps.clear();
    axis.build(1024, 200, boxes, gaps);
    axis.setZoom(0);
    assert(axis.width() == 264);
    assert(axis.project(400) - axis.project(50) >= 130);

    // Empty track can shrink to the viewport and expand again.
    boxes.clear();
    gaps.clear();
    axis.build(1024, 200, boxes, gaps);
    axis.setZoom(0);
    assert(axis.width() == 200);
    axis.setZoom(3);
    assert(axis.width() == 3072);
}
