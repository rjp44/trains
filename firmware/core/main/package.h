#pragma once
#include "cJSON.h"
#include "esp_partition.h"
#include <cstdint>
#include <cstddef>
#include <vector>
#include <string>
namespace transport {
struct Bytes {
    uint8_t *data{};
    size_t size{};
};
struct AppInfo {
    std::string id, name, description, adapter, credits;
    unsigned version = 0, bytes = 0;
};
bool inspectPackage(const uint8_t *bytes, size_t limit, AppInfo &info, bool verifyContents);
bool inspectStored(const esp_partition_t *partition, unsigned offset, unsigned limit, AppInfo &info);
bool openPackage(const esp_partition_t *partition, unsigned offset, unsigned length, const AppInfo &info);
Bytes unpack(const char *name);
bool inflate(const uint8_t *source, size_t size, uint8_t *dest, size_t length);
uint32_t little(const uint8_t *);
extern const cJSON *tables;
extern Bytes corridor;
extern unsigned defaultView, defaultRecording;
extern float defaultZoom;
extern std::string vehicleFeed;
} // namespace transport
namespace lakes {
bool mountPackage();
}
namespace hemel {
bool mountPackage();
}
