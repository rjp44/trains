#include "core.h"
#include "preferences.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "package.h"
#include "library.h"
#include "directory.h"
#include "version.h"
#include "wifi.h"
#include <ctime>
#include "esp_crt_bundle.h"
#include <map>
#include <set>
#include "esp_app_desc.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/base64.h"
#include "mbedtls/pk.h"
#include "mbedtls/sha256.h"
#include "nvs.h"
#include <algorithm>
#include <array>
#include <atomic>
#include <cstring>
#include <memory>
#include <mutex>

namespace transport {
namespace {
extern "C" const char pub[] asm("_binary_signing_pem_start");
constexpr char board[] = "crowpanel-p4-v1.2-rev1";
constexpr const char *bankNames[] = {"hemel0", "hemel1", "lakes0", "lakes1"};
Library state;
nvs_handle_t handle;
bool usable;
AppInfo mounted;
std::map<uint16_t, AppInfo> stored;
std::vector<Listing> catalog;
std::mutex guard;
std::atomic<bool> busy{false};
// UI thread owns the request and retry deadline. Workers publish the last successful check.
bool checkWanted = false;
int64_t nextCheck = 0;
int64_t lastVerified = -1; // protected by guard
unsigned revision = 1;
std::string message = "The directory will update when Wi-Fi and network time are ready.";
void note(std::string text) {
    ESP_LOGI("updates", "%s", text.c_str());
    std::lock_guard<std::mutex> l(guard);
    message = std::move(text);
    ++revision;
}
bool save(const Library &next) {
    auto data = next.encode();
    if (!usable || nvs_set_blob(handle, "library2", data.data(), data.size() * 2) != ESP_OK ||
        nvs_commit(handle) != ESP_OK)
        return false;
    state = next;
    ++revision;
    return true;
}
const esp_partition_t *bank(Extent e) {
    if (e.start >= bankCount * bankSectors)
        return nullptr;
    return esp_partition_find_first((esp_partition_type_t)0x40, ESP_PARTITION_SUBTYPE_ANY,
                                    bankNames[e.start / bankSectors]);
}
unsigned offset(Extent e) { return (e.start % bankSectors) * sectorBytes; }
Extent fileFor(const std::string &id) {
    for (auto i : state.items) {
        auto it = stored.find(i.file.start);
        if (it != stored.end() && it->second.id == id)
            return i.file;
    }
    return {};
}
bool supported(const std::string &adapter) {
    return adapter == "hemel-corridor/1" || adapter == "lakes-map/1";
}
bool verifySignature(const uint8_t *body, size_t n, const uint8_t *sig, size_t size) {
    uint8_t digest[32];
    if (mbedtls_sha256(body, n, digest, 0))
        return false;
    mbedtls_pk_context key;
    mbedtls_pk_init(&key);
    bool ok = mbedtls_pk_parse_public_key(&key, (const uint8_t *)pub, strlen(pub) + 1) == 0 &&
              mbedtls_pk_verify(&key, MBEDTLS_MD_SHA256, digest, 32, sig, size) == 0;
    mbedtls_pk_free(&key);
    return ok;
}
using Client =
    std::unique_ptr<std::remove_pointer_t<esp_http_client_handle_t>, decltype(&esp_http_client_cleanup)>;
Client get(const std::string &path, int &length) {
    for (const char *origin : {TRANSPORT_RELEASE_URL, "https://trains-panel.netlify.app"}) {
        std::string url = std::string(origin) + path;
        esp_http_client_config_t c{};
        c.url = url.c_str();
        c.crt_bundle_attach = esp_crt_bundle_attach;
        c.timeout_ms = 12000;
        c.disable_auto_redirect = true;
        c.buffer_size = 4096;
        Client h(esp_http_client_init(&c), esp_http_client_cleanup);
        if (!h)
            continue;
        esp_http_client_set_header(h.get(), "Accept-Encoding", "identity");
        if (esp_http_client_open(h.get(), 0) != ESP_OK)
            continue;
        auto n = esp_http_client_fetch_headers(h.get());
        if (n >= 0 && n <= 0x300000 && esp_http_client_get_status_code(h.get()) == 200) {
            length = int(n);
            return h;
        }
    }
    length = -1;
    return Client(nullptr, esp_http_client_cleanup);
}
bool base64(const cJSON *p, std::vector<uint8_t> &out) {
    auto s = cJSON_GetStringValue(p);
    if (!s)
        return false;
    size_t n = strlen(s), w = 0;
    out.resize(n + 1);
    if (mbedtls_base64_decode(out.data(), n, &w, (const uint8_t *)s, n) != 0)
        return false;
    out.resize(w);
    return w > 0;
}
using Json = std::unique_ptr<cJSON, decltype(&cJSON_Delete)>;
bool check() {
    int len = -1;
    auto client = get("/catalog.json", len);
    constexpr int limit = 1024 * 1024;
    if (!client || len > limit) {
        note("Public directory unavailable. Check Wi-Fi and the clock.");
        return false;
    }
    std::vector<char> bytes;
    bytes.reserve(len > 0 ? len + 1 : 8192);
    char block[3072];
    int n;
    while ((n = esp_http_client_read(client.get(), block, sizeof block)) > 0) {
        if (bytes.size() + n > limit) {
            note("Directory exceeds the reader limit");
            return false;
        }
        bytes.insert(bytes.end(), block, block + n);
    }
    if (n < 0 || bytes.empty() || (len && int(bytes.size()) != len) ||
        !esp_http_client_is_complete_data_received(client.get())) {
        note("Incomplete directory");
        return false;
    }
    bytes.push_back(0);
    Json envelope(cJSON_Parse(bytes.data()), cJSON_Delete);
    std::vector<uint8_t> payload, signature;
    if (!base64(cJSON_GetObjectItem(envelope.get(), "payload"), payload) ||
        !base64(cJSON_GetObjectItem(envelope.get(), "signature"), signature) ||
        !verifySignature(payload.data(), payload.size(), signature.data(), signature.size())) {
        note("Catalogue signature failed");
        return false;
    }
    payload.push_back(0);
    Json doc(cJSON_Parse((char *)payload.data()), cJSON_Delete);
    auto target = cJSON_GetStringValue(cJSON_GetObjectItem(doc.get(), "board"));
    if (!target || strcmp(target, board) ||
        cJSON_GetNumberValue(cJSON_GetObjectItem(doc.get(), "schema")) != 2) {
        note("Incompatible release catalogue");
        return false;
    }
    auto entries = cJSON_GetObjectItem(doc.get(), "artifacts");
    if (!cJSON_IsObject(entries)) {
        note("Missing directory entries");
        return false;
    }
    std::vector<Listing> verified;
    std::set<std::string> ids;
    for (auto e = entries->child; e; e = e->next) {
        std::string id = e->string ? e->string : "";
        if (id.empty() || id.size() > 40 || id[0] < 'a' || id[0] > 'z' ||
            id.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789-") != std::string::npos ||
            !ids.insert(id).second || verified.size() >= 1024) {
            note("Invalid or duplicate directory ID");
            return false;
        }
        auto str = [&](const char *k) {
            auto v = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(e, k));
            return std::string(v ? v : "");
        };
        auto hash = cJSON_GetStringValue(cJSON_GetObjectItem(e, "sha256"));
        auto number = [&](const char *k, unsigned max) -> unsigned {
            auto p = cJSON_GetObjectItem(e, k);
            if (!cJSON_IsNumber(p) || p->valuedouble < 1 || p->valuedouble > max ||
                p->valuedouble != p->valueint)
                return 0;
            return p->valueint;
        };
        Listing r;
        r.id = id;
        r.version = number("version", 0x7ffffffe);
        r.size = number("bytes", id == "core" ? 0x300000 : 0x270000);
        r.minCore = number("minCore", 0x7ffffffe);
        if (!hash || strlen(hash) != 64 || strspn(hash, "0123456789abcdef") != 64 || !r.size ||
            !r.minCore || !r.version) {
            note("Invalid release entry");
            return false;
        }
        r.hash = hash;
        if (id != "core") {
            r.name = str("name");
            r.description = str("description");
            r.adapter = str("adapter");
            if (r.name.empty() || r.name.size() > 96 || r.description.empty() ||
                r.description.size() > 512 || r.adapter.empty() || r.adapter.size() > 80) {
                note("Incomplete app description");
                return false;
            }
        }
        verified.push_back(std::move(r));
    }
    {
        std::lock_guard<std::mutex> lock(guard);
        catalog = std::move(verified);
        lastVerified = esp_timer_get_time();
        ++revision;
    }
    note("Signed catalogue verified");
    return true;
}
bool install(const std::string &id) {
    Listing r;
    Library before;
    Extent old, slot;
    unsigned oldVersion = 0;
    bool core = id == "core";
    {
        std::lock_guard<std::mutex> l(guard);
        auto it =
            std::find_if(catalog.begin(), catalog.end(), [&](const Listing &e) { return e.id == id; });
        if (it == catalog.end()) {
            message = "App unavailable in this directory";
            ++revision;
            return false;
        }
        r = *it;
        before = state;
        old = fileFor(id);
        slot = state.allocate(r.size);
        oldVersion = core ? TRANSPORT_VERSION : old.pages ? stored.at(old.start).version : 0;
    }
    if (!usable || r.minCore > TRANSPORT_VERSION || (!core && !supported(r.adapter))) {
        note("A compatible core is required");
        return false;
    }
    if (r.version <= oldVersion) {
        note("Already current");
        return false;
    }
    auto part = core ? esp_ota_get_next_update_partition(nullptr) : bank(slot);
    if (!part || (!core && !slot.pages)) {
        note("Insufficient contiguous space. Delete an installed app first.");
        return false;
    }
    int len = -1;
    auto client = get("/artifacts/" + r.hash + (core ? ".bin" : ".tda"), len);
    if (!client || (len && len != int(r.size)) || r.size > part->size) {
        note("Artifact unavailable or size mismatch");
        return false;
    }
    // Flash writes share resources with continuous panel scanout. Download first so
    // the screen can remain fully active for the duration of a slow network transfer.
    std::unique_ptr<uint8_t, decltype(&free)> image(
        static_cast<uint8_t *>(heap_caps_malloc(r.size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)), free);
    if (!image) {
        note("Insufficient staging RAM. Release was not installed.");
        return false;
    }
    unsigned off = 0, reported = 0;
    while (off < r.size) {
        auto n = esp_http_client_read(client.get(), (char *)image.get() + off,
                                      std::min<unsigned>(8192, r.size - off));
        if (n <= 0)
            break;
        off += n;
        if (off * 10 / r.size > reported) {
            reported = off * 10 / r.size;
            note(std::string("Downloading ") + id + " " + std::to_string(reported * 10) + "%");
        }
    }
    client.reset();
    uint8_t digest[32];
    if (off != r.size || mbedtls_sha256(image.get(), off, digest, 0)) {
        note("Download incomplete");
        return false;
    }
    char hex[65];
    for (int j = 0; j < 32; j++)
        snprintf(hex + j * 2, 3, "%02x", digest[j]);
    if (r.hash != hex) {
        note("Artifact checksum failed");
        return false;
    }
    AppInfo manifest;
    if (!core && (!inspectPackage(image.get(), off, manifest, true) || manifest.bytes != r.size ||
                  manifest.id != id || manifest.version != r.version || manifest.adapter != r.adapter ||
                  manifest.name != r.name)) {
        note("Package and directory disagree");
        return false;
    }
    note("Verified. Screen will turn off briefly while installing.");
    vTaskDelay(pdMS_TO_TICKS(700));
    struct Programming {
        bool dark;
        Programming() {
            lockDisplay();
            dark = panel::gateBacklight(true);
        }
        ~Programming() {
            panel::gateBacklight(false);
            unlockDisplay();
        }
    } programming;
    if (!programming.dark) {
        note("Cannot prepare display for flash programming");
        return false;
    }
    int64_t started = esp_timer_get_time();
    esp_ota_handle_t ota{};
    esp_err_t rc = core ? esp_ota_begin(part, r.size, &ota)
                        : esp_partition_erase_range(part, offset(slot), (r.size + 4095) & ~4095u);
    if (rc != ESP_OK) {
        note("Cannot prepare inactive slot");
        return false;
    }
    uint8_t block[4096];
    for (unsigned pos = 0; pos < off;) {
        unsigned n = std::min<unsigned>(sizeof block, off - pos);
        memcpy(block, image.get() + pos, n);
        rc = core ? esp_ota_write(ota, block, n) : esp_partition_write(part, offset(slot) + pos, block, n);
        if (rc != ESP_OK) {
            if (core)
                esp_ota_abort(ota);
            note("Flash write failed");
            return false;
        }
        pos += n;
    }
    ESP_LOGI("updates", "Programmed %u bytes in %lld ms", off, (esp_timer_get_time() - started) / 1000);
    if (core) {
        esp_app_desc_t app{};
        if (esp_ota_end(ota) != ESP_OK || esp_ota_get_partition_description(part, &app) != ESP_OK ||
            strcmp(app.project_name, "transport_display") || std::to_string(r.version) != app.version ||
            esp_ota_set_boot_partition(part) != ESP_OK) {
            note("Core identity or image validation failed");
            return false;
        }
    } else {
        Library next = before;
        const bool replaceActive = old.pages && old.start == next.selected;
        if (auto *i = next.at(old.start)) {
            // Preserve the last boot-confirmed version across repeated downloads.
            Extent previous = i->candidate ? i->previous : i->file;
            *i = {slot, previous, true};
        } else
            next.items.push_back({slot, {}, true});
        if (replaceActive) {
            next.pending = slot.start;
            next.selected = slot.start;
            next.attempted = false;
        }
        {
            std::lock_guard<std::mutex> l(guard);
            if (!save(next)) {
                message = "Could not save app library";
                ++revision;
                return false;
            }
            stored[slot.start] = manifest;
        }
        if (!replaceActive) {
            note(manifest.name + " installed");
            return true;
        }
    }
    note("Update verified. Restarting.");
    esp_restart();
    return true;
}
void job(void *arg) {
    {
        std::unique_ptr<std::string> op(static_cast<std::string *>(arg));
        if (check() && !op->empty())
            install(*op);
    }
    busy = false;
    {
        std::lock_guard<std::mutex> l(guard);
        ++revision;
    }
    vTaskDelete(nullptr);
}
bool readFile(Extent e, AppInfo &info) {
    return inspectStored(bank(e), offset(e), e.pages * sectorBytes, info);
}
bool migrate() {
    struct Old {
        uint32_t format, versions[2][2];
        uint8_t banks[2], selected, pending, trialBank, attempting;
    };
    Old v{};
    size_t n = sizeof v;
    auto rc = nvs_get_blob(handle, "library", &v, &n);
    Library next;
    if (rc == ESP_ERR_NVS_NOT_FOUND)
        return save(next);
    if (rc != ESP_OK || n != sizeof v || v.format != 1 || v.selected > 1 || v.banks[0] > 1 ||
        v.banks[1] > 1)
        return false;
    for (unsigned id = 0; id < 2; id++) {
        unsigned b = v.banks[id];
        if (!v.versions[id][b])
            continue;
        Extent file{uint16_t((id * 2 + b) * bankSectors), bankSectors};
        AppInfo m;
        if (!readFile(file, m) || m.id != (id ? "lakes" : "hemel") || m.version != v.versions[id][b])
            return false;
        file.pages = (m.bytes + sectorBytes - 1) / sectorBytes;
        next.items.push_back({file, {}, false});
        if (v.selected == id)
            next.selected = file.start;
    }
    return save(next);
}
} // namespace
void storageInit() {
    usable = nvs_open("transport", NVS_READWRITE, &handle) == ESP_OK;
    if (!usable) {
        note("App library unavailable");
        return;
    }
    size_t n = 0;
    auto rc = nvs_get_blob(handle, "library2", nullptr, &n);
    if (rc == ESP_ERR_NVS_NOT_FOUND)
        usable = migrate();
    else if (rc == ESP_OK && !(n % 2) && n <= 8 + bankCount * bankSectors * 10) {
        std::vector<uint16_t> data(n / 2);
        usable = nvs_get_blob(handle, "library2", data.data(), &n) == ESP_OK && state.decode(data);
    } else
        usable = false;
    if (!usable) {
        note("Could not read the installed library");
        return;
    }
    if (state.attempted) {
        Library next = state;
        next.reject();
        usable = save(next);
        note("Previous selection restored");
    }
    Library repaired = state;
    for (auto i : state.items) {
        AppInfo m;
        bool previousOK = i.previous.pages && readFile(i.previous, m);
        if (previousOK)
            stored[i.previous.start] = m;
        if (readFile(i.file, m)) {
            stored[i.file.start] = m;
            if (!previousOK)
                repaired.at(i.file.start)->previous = {};
        } else if (previousOK) {
            if (repaired.selected == i.file.start)
                repaired.selected = i.previous.start;
            if (repaired.pending == i.file.start)
                repaired.pending = none;
            *repaired.at(i.file.start) = {i.previous, {}, false};
        } else
            repaired.remove(i.file.start);
    }
    if (state.encode() != repaired.encode())
        usable = save(repaired);
}
bool mount() {
    if (!usable)
        return false;
    auto start = state.pending == none ? state.selected : state.pending;
    auto *i = state.at(start);
    if (!i)
        return false;
    auto file = i->file;
    if (state.pending != none) {
        auto next = state;
        next.attempted = true;
        if (!save(next))
            return false;
    }
    auto m = stored.at(start);
    if (!openPackage(bank(file), offset(file), file.pages * sectorBytes, m)) {
        failedBoot();
        auto next = state;
        next.pending = start;
        if (!next.at(start)->candidate)
            next.remove(start);
        else
            next.reject();
        if (save(next))
            esp_restart();
        return false;
    }
    mounted = m;
    return true;
}
void validated() {
    esp_ota_img_states_t s;
    if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &s) == ESP_OK &&
        s == ESP_OTA_IMG_PENDING_VERIFY) {
        if (!usable) {
            esp_ota_mark_app_invalid_rollback_and_reboot();
            return;
        }
        ESP_ERROR_CHECK(esp_ota_mark_app_valid_cancel_rollback());
        requestDirectoryCheck();
    }
    if (state.pending != none) {
        auto next = state;
        next.confirm();
        if (!save(next))
            esp_restart();
    }
}
void failedBoot() {
    esp_ota_img_states_t s;
    if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &s) == ESP_OK &&
        s == ESP_OTA_IMG_PENDING_VERIFY)
        esp_ota_mark_app_invalid_rollback_and_reboot();
    if (state.attempted)
        esp_restart();
}
const char *activeApp() { return mounted.id.empty() ? "recovery" : mounted.id.c_str(); }
const char *activeAdapter() { return mounted.adapter.c_str(); }
std::string status() {
    std::lock_guard<std::mutex> l(guard);
    std::string s =
        "Running " + std::string(activeApp()) + " | Core " + versionLabel(TRANSPORT_VERSION) + "\n";
    for (auto i : state.items) {
        const auto &a = stored.at(i.file.start);
        s += a.id + " " + versionLabel(a.version) + "\n";
    }
    return s + "Free " + std::to_string(state.freeBytes()) + " bytes; directory " +
           std::to_string(catalog.size() - (std::any_of(catalog.begin(), catalog.end(),
                                                        [](const auto &e) { return e.id == "core"; })
                                                ? 1
                                                : 0)) +
           " apps\n" + message;
}
void action(const char *raw) {
    if (busy.exchange(true))
        return;
    std::string cmd(raw);
    if (cmd == "check" || cmd.rfind("install ", 0) == 0) {
        auto op = new (std::nothrow) std::string(cmd == "check" ? "" : cmd.substr(8));
        note("Checking public directory...");
        if (op && xTaskCreate(job, "release", 16384, op, 4, nullptr) == pdPASS)
            return;
        delete op;
        note("Insufficient update memory");
    } else {
        std::lock_guard<std::mutex> l(guard);
        bool open = cmd.rfind("open ", 0) == 0, del = cmd.rfind("delete ", 0) == 0;
        auto id = open ? cmd.substr(5) : del ? cmd.substr(7) : std::string{};
        auto file = fileFor(id);
        if (!file.pages)
            message = "App is not installed";
        else if (open && id != mounted.id) {
            auto next = state;
            next.pending = file.start;
            next.attempted = false;
            if (save(next))
                esp_restart();
            message = "Could not switch app";
        } else if (del) {
            auto next = state;
            next.remove(file.start);
            if (save(next)) {
                if (id == mounted.id)
                    esp_restart();
                message = "App deleted";
            } else
                message = "Could not delete app";
        }
        ++revision;
    }
    busy = false;
}
unsigned directoryRevision() {
    std::lock_guard<std::mutex> l(guard);
    return revision;
}
void requestDirectoryCheck() {
    checkWanted = true;
}
void pollDirectoryCheck() {
    if (!checkWanted) return;
    const auto now = esp_timer_get_time();
    {
        std::lock_guard<std::mutex> lock(guard);
        if (lastVerified >= 0 && now - lastVerified < 300000000LL) {
            checkWanted = false;
            return;
        }
    }
    if (busy || now < nextCheck || !(wifi_link_state() & 1) || std::time(nullptr) < 1700000000)
        return;
    nextCheck = now + 15000000;
    action("check");
}
Directory directory() {
    std::lock_guard<std::mutex> l(guard);
    Directory d;
    d.free = state.freeBytes();
    d.capacity = bankCount * bankSectors * sectorBytes;
    d.message = message;
    d.busy = busy;
    std::map<std::string, Listing> all;
    for (auto r : catalog) {
        if (r.id == "core") {
            if (r.version > TRANSPORT_VERSION) d.updateCore = r.version;
            continue;
        }
        r.fits = state.allocate(r.size).pages;
        r.compatible = r.minCore <= TRANSPORT_VERSION && supported(r.adapter);
        all.emplace(r.id, std::move(r));
    }
    for (auto i : state.items) {
        auto m = stored.find(i.file.start);
        if (m == stored.end())
            continue;
        auto &a = m->second;
        auto &r = all[a.id];
        r.id = a.id;
        if (r.name.empty()) {
            r.name = a.name;
            r.description = a.description;
        }
        r.installed = a.version;
        r.used = (i.file.pages + i.previous.pages) * sectorBytes;
    }
    for (auto &e : all)
        d.apps.push_back(std::move(e.second));
    std::sort(d.apps.begin(), d.apps.end(), [](const auto &a, const auto &b) { return a.name < b.name; });
    return d;
}
std::string installedVersions() {
    auto text = "Core " + versionLabel(TRANSPORT_VERSION);
    if (mounted.version) text += " · " + mounted.name + " " + versionLabel(mounted.version);
    return text;
}
std::string sourceCredits() { return mounted.credits; }
} // namespace transport
