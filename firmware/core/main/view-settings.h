#pragma once
#include "nvs.h"
#include <cstring>
namespace transport {
// Each namespace holds one small record. Skip writes when the stored value already matches.
template <class T> bool loadView(const char *space, T &value) {
    nvs_handle_t h;
    if (nvs_open(space, NVS_READONLY, &h) != ESP_OK)
        return false;
    size_t n = sizeof(T);
    T tmp{};
    auto result = nvs_get_blob(h, "view", &tmp, &n);
    nvs_close(h);
    if (result != ESP_OK || n != sizeof tmp)
        return false;
    value = tmp;
    return true;
}
template <class T> void saveView(const char *space, const T &value) {
    T current{};
    if (loadView(space, current) && !memcmp(&current, &value, sizeof value))
        return;
    nvs_handle_t h;
    if (nvs_open(space, NVS_READWRITE, &h) != ESP_OK)
        return;
    if (nvs_set_blob(h, "view", &value, sizeof value) == ESP_OK)
        nvs_commit(h);
    nvs_close(h);
}
} // namespace transport
