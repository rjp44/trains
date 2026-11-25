#pragma once
#include <string_view>
#include <cstdint>
void wifi_start();
void wifi_save(std::string_view command);
void public_feed_start();
uint32_t wifi_link_state(); // odd while associated with an IP, changes on link loss
