#include "package.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "miniz.h"
#include "mbedtls/sha256.h"
#include <cstring>
#include <memory>
namespace transport {
static const uint8_t *blob;
static unsigned count;
static esp_partition_mmap_handle_t mapping;
const cJSON *tables;
Bytes corridor;
unsigned defaultView, defaultRecording;
float defaultZoom = 1;
uint32_t little(const uint8_t *p) {
    return unsigned(p[0]) | (unsigned(p[1]) << 8) | (unsigned(p[2]) << 16) | (unsigned(p[3]) << 24);
}
bool inflate(const uint8_t *source, size_t size, uint8_t *dest, size_t length) {
    auto *decoder =
        static_cast<tinfl_decompressor *>(heap_caps_malloc(sizeof(tinfl_decompressor), MALLOC_CAP_SPIRAM));
    if (!decoder)
        return false;
    tinfl_init(decoder);
    size_t read = size, written = length;
    auto rc = tinfl_decompress(decoder, source, &read, dest, dest, &written,
                               TINFL_FLAG_PARSE_ZLIB_HEADER | TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF);
    free(decoder);
    return rc == TINFL_STATUS_DONE && read == size && written == length;
}
static Bytes readSection(const uint8_t *blob, unsigned count, const char *name) {
    for (unsigned i = 0; i < count; i++) {
        auto e = blob + 8 + 96 * i;
        if (strcmp(reinterpret_cast<const char *>(e), name))
            continue;
        auto len = little(e + 56), size = little(e + 52);
        auto src = blob + little(e + 48);
        auto *p = static_cast<uint8_t *>(heap_caps_malloc(len + 1, MALLOC_CAP_SPIRAM));
        if (!p)
            return {};
        if (little(e + 60)) {
            if (!inflate(src, size, p, len)) {
                free(p);
                return {};
            }
        } else
            memcpy(p, src, len);
        p[len] = 0;
        return {p, len};
    }
    return {};
}
Bytes unpack(const char *name) { return readSection(blob, count, name); }
bool inspectPackage(const uint8_t *blob, size_t limit, AppInfo &info, bool verifyContents) {
    if (limit < 8 || memcmp(blob, "TDA2", 4))
        return false;
    unsigned count = little(blob + 4);

    if (!count || count > 32 || 8 + count * 96 > limit)
        return false;
    unsigned end = 8 + count * 96;
    for (unsigned i = 0; i < count; i++) {
        auto e = blob + 8 + 96 * i;
        auto size = little(e + 52), raw = little(e + 56), codec = little(e + 60);
        if (!e[0] || !memchr(e, 0, 48) || little(e + 48) != end || !size || size > limit - end || !raw ||
            raw > 5 * 1024 * 1024 || codec > 1 || (!codec && size != raw))
            return false;
        for (unsigned j = 0; j < i; j++)
            if (!strncmp((const char *)e, (const char *)blob + 8 + 96 * j, 48))
                return false;
        uint8_t hash[32];
        if ((verifyContents || !strcmp((const char *)e, "manifest.json")) &&
            (mbedtls_sha256(blob + end, size, hash, 0) || memcmp(hash, e + 64, 32)))
            return false;
        end += size;
    }
    auto manifest = readSection(blob, count, "manifest.json");
    cJSON *m = manifest.data ? cJSON_Parse((char *)manifest.data) : nullptr;
    free(manifest.data);
    auto text = [&](const char *key) -> std::string {
        auto s = cJSON_GetStringValue(cJSON_GetObjectItem(m, key));
        return s ? s : "";
    };
    auto v = cJSON_GetObjectItem(m, "version");
    info = {text("id"), text("name"), text("description"), text("adapter"), text("credits"), 0, end};
    bool ok = cJSON_IsNumber(v) && v->valueint > 0 && v->valueint == v->valuedouble && !info.id.empty() &&
              info.id.size() <= 40 && !info.name.empty() && info.name.size() <= 96 &&
              info.credits.size() <= 4096;
    if (ok)
        info.version = v->valueint;
    cJSON_Delete(m);
    return ok;
}
bool inspectStored(const esp_partition_t *p, unsigned off, unsigned limit, AppInfo &info) {
    if (!p || off >= p->size || limit > p->size - off)
        return false;
    const void *mapped;
    esp_partition_mmap_handle_t h;
    if (esp_partition_mmap(p, off, limit, ESP_PARTITION_MMAP_DATA, &mapped, &h) != ESP_OK)
        return false;
    bool ok = inspectPackage(static_cast<const uint8_t *>(mapped), limit, info, false);
    esp_partition_munmap(h);
    return ok;
}
bool openPackage(const esp_partition_t *part, unsigned offset, unsigned length, const AppInfo &info) {
    if (!part || esp_partition_mmap(part, offset, length, ESP_PARTITION_MMAP_DATA, (const void **)&blob,
                                    &mapping) != ESP_OK)
        return false;
    AppInfo checked;
    if (!inspectPackage(blob, length, checked, true) || checked.id != info.id ||
        checked.version != info.version ||
        (checked.adapter != "hemel-corridor/1" && checked.adapter != "lakes-map/1"))
        return false;
    count = little(blob + 4);
    auto manifest = unpack("manifest.json");
    cJSON *m = manifest.data ? cJSON_Parse((char *)manifest.data) : nullptr;
    free(manifest.data);
    bool ok = m;
    if (ok && checked.adapter == "hemel-corridor/1") {
        auto scene = [&](const char *key, unsigned &out) {
            const char *name = cJSON_GetStringValue(cJSON_GetObjectItem(m, key));
            const char *views[] = {"sector", "hemel", "watford"};
            for (unsigned i = 0; name && i < 3; i++)
                if (!strcmp(name, views[i])) {
                    out = i;
                    return true;
                }
            return false;
        };
        ok = scene("defaultView", defaultView) && scene("defaultRecording", defaultRecording);
    } else if (ok) {
        const double zoom = cJSON_GetNumberValue(cJSON_GetObjectItem(m, "defaultZoom"));
        ok = zoom >= 1 && zoom <= 24;
        if (ok)
            defaultZoom = zoom;
    }
    cJSON_Delete(m);
    if (!ok)
        return false;
    auto bytes = unpack("native/tables.json");
    tables = bytes.data ? cJSON_Parse((char *)bytes.data) : nullptr;
    free(bytes.data);
    if (!tables)
        return false;
    if (checked.adapter == "hemel-corridor/1") {
        corridor = unpack("data/corridor.json");
        return corridor.data && hemel::mountPackage();
    }
    return lakes::mountPackage();
}
} // namespace transport
