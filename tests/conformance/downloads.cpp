#include "core.h"
#include "directory.h"
#include <cassert>
#include <cstring>

namespace {
transport::Directory snapshot;
unsigned revision{}, requests{}, polls{};
std::string command;
lv_obj_t *findLabel(lv_obj_t *p, const char *text) {
    if (lv_obj_check_type(p, &lv_label_class) && !strcmp(lv_label_get_text(p), text)) return p;
    for (unsigned i = 0; i < lv_obj_get_child_count(p); ++i)
        if (auto match = findLabel(lv_obj_get_child(p, i), text)) return match;
    return nullptr;
}
lv_obj_t *button(lv_obj_t *page, const char *caption) {
    auto text = findLabel(page, caption);
    assert(text);
    auto parent = lv_obj_get_parent(text);
    assert(lv_obj_check_type(parent, &lv_button_class));
    return parent;
}
}
namespace transport {
Directory directory() { return snapshot; }
unsigned directoryRevision() { return revision; }
void requestDirectoryCheck() { ++requests; }
void pollDirectoryCheck() { ++polls; }
const char *activeApp() { return "lakes"; }
void action(const char *cmd) { command = cmd; }
std::string installedVersions() { return {}; }
std::string sourceCredits() { return {}; }
}
int main() {
    lv_init();
    lv_display_create(600, 1024);
    auto page = lv_obj_create(lv_screen_active());
    transport::Listing lakes;
    lakes.id = "lakes";
    lakes.name = "Lakes";
    lakes.installed = 9004;
    snapshot.apps = {lakes};
    transport::appsPage(page);
    assert(requests == 1 && findLabel(page, "Lakes (open)") && command.empty());

    // The async catalogue arrives while the user is still on Installed.
    auto &app = snapshot.apps.front();
    app.version = 9005;
    app.minCore = 9007;
    app.fits = true;
    snapshot.updateCore = 9007;
    ++revision;
    transport::pollApps();
    assert(!lv_obj_has_state(button(page, "Update firmware to v0.9.7"), LV_STATE_DISABLED));
    assert(lv_obj_has_state(button(page, "Update"), LV_STATE_DISABLED));
    assert(findLabel(page, "Upgrade core first (requires v0.9.7)."));
    assert(!lv_obj_has_state(button(page, "Delete..."), LV_STATE_DISABLED));

    snapshot.apps.front().installed = 0;
    lv_obj_send_event(button(page, "Directory"), LV_EVENT_CLICKED, nullptr);
    transport::pollApps();
    assert(lv_obj_has_state(button(page, "Download"), LV_STATE_DISABLED));
    assert(command.empty());

    // A compatible catalogue can update the open page without another tap.
    app.installed = 9004;
    app.minCore = 9006;
    app.compatible = true;
    snapshot.updateCore = 0;
    ++revision;
    transport::pollApps();
    assert(!findLabel(page, "Upgrade core first (requires v0.9.7)."));
    assert(!lv_obj_has_state(button(page, "Update"), LV_STATE_DISABLED));
    lv_obj_send_event(button(page, "Update"), LV_EVENT_CLICKED, nullptr);
    assert(command == "install lakes");
    lv_obj_delete(page);
    auto last = polls;
    transport::pollApps();
    assert(polls == last + 1);
}
