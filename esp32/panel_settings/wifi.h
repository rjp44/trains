#pragma once
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

struct WifiNetwork {
    std::string ssid;
    bool secured;
};
struct WifiStatus {
    std::string message;
    std::vector<WifiNetwork> networks;
    bool busy = false;
    unsigned revision = 0;
};
void wifi_start(void (*onFirstConnection)());
void public_feed_start();
void wifi_save(std::string_view command);
uint32_t wifi_link_state();
WifiStatus wifi_status();
unsigned wifi_revision();
bool wifi_scan();
bool wifi_join(std::string_view ssid, std::string_view password);
