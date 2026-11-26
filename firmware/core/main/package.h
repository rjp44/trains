#pragma once
#include "cJSON.h"
#include "esp_partition.h"
#include <cstdint>
#include <cstddef>
#include <vector>
namespace transport {
struct Bytes {
    uint8_t *data{};
    size_t size{};
};
bool openPackage(const esp_partition_t *partition, const char *id, unsigned expectedVersion);
Bytes unpack(const char *name);
bool inflate(const uint8_t *source, size_t size, uint8_t *dest, size_t length);
uint32_t little(const uint8_t *);
extern const cJSON *tables;
extern Bytes corridor;
extern unsigned defaultView, defaultRecording;
extern float defaultZoom;
} // namespace transport
namespace lakes {
bool mountPackage();
}
namespace hemel {
bool mountPackage();
}
