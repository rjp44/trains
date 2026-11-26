#include "../../firmware/core/main/gestures.h"
#include "../../firmware/core/main/toolbar.h"
#include <cassert>
#include <vector>

using namespace transport;
int main() {
    Gesture gesture;
    auto one = [&](int x, int y) { return gesture.sample({1, {{uint16_t(x), uint16_t(y)}, {}}}); };
    auto two = [&](int x1, int x2) {
        return gesture.sample({2, {{uint16_t(x1), 200}, {uint16_t(x2), 200}}});
    };
    assert(one(30, 25) == ContactEvent::None);
    assert(gesture.sample({}) == ContactEvent::SingleEnd && !gesture.dragged);
    one(130, 200);
    assert(two(130, 230) == ContactEvent::PinchStart);
    assert(gesture.span == 100 && gesture.centre.x == 180);
    assert(two(245, 115) == ContactEvent::PinchMove); // Controller may reorder contacts.
    assert(gesture.span == 130 && pinchThreshold(100, gesture.span, true));
    assert(one(115, 200) == ContactEvent::None);
    assert(gesture.sample({}) == ContactEvent::PinchEnd);
    assert(gesture.sample({}) == ContactEvent::None);
    one(10, 100); one(35, 100); one(10, 100);
    assert(gesture.sample({}) == ContactEvent::SingleEnd && gesture.dragged);
    assert(!pinchThreshold(100, 103, false) && pinchThreshold(100, 85, false));
    assert(!pinchThreshold(100, 85, true) && pinchThreshold(100, 79, true));

    for (bool portrait : {false, true}) {
        int width = portrait ? 600 : 1024;
        assert(toolbarButton(24, 24, width) == ToolbarButton::Settings);
        assert(toolbarButton(width - 24, 24, width) == ToolbarButton::Theme);
        assert(toolbarButton(24, toolbarHeight, width) == ToolbarButton::None);
        assert(toolbarButton(width / 2, 24, width) == ToolbarButton::None);
        std::vector<uint16_t> image(1024 * 600, 0);
        drawToolbar(image.data(), portrait, false);
        auto at = [&](int x, int y) { return portrait ? x * 1024 + 1023 - y : y * 1024 + x; };
        assert(image[at(24,24)] && image[at(width-24,24)]);
        for (int x = 0; x < width; ++x) assert(!image[at(x, toolbarHeight)]);
    }
}
