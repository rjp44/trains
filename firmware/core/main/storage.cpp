#include "core.h"
#include "preferences.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "package.h"
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
extern "C" const char ca[] asm("_binary_ca_pem_start"), pub[] asm("_binary_signing_pem_start");
constexpr char board[] = "crowpanel-p4-v1.2-rev1";
constexpr const char *names[] = {"hemel", "lakes", "core"};
struct Library {
    uint32_t format = 1, versions[2][2]{};
    uint8_t banks[2]{}, selected = 1, pending = 2, trialBank = 0, attempting = 0;
};
Library state;
nvs_handle_t handle;
bool usable, trial;
unsigned running = 2;
struct Release {
    unsigned version{}, size{}, minCore{};
    std::string hash;
};
std::array<Release, 3> catalog;
std::mutex guard;
std::atomic<bool> busy{false};
std::string message = "Check for available releases";
void note(std::string text) {
    ESP_LOGI("updates", "%s", text.c_str());
    std::lock_guard<std::mutex> lock(guard);
    message = std::move(text);
}
bool save(const Library &next) {
    if (!usable || nvs_set_blob(handle, "library", &next, sizeof next) != ESP_OK ||
        nvs_commit(handle) != ESP_OK)
        return false;
    state = next;
    return true;
}
const esp_partition_t *bank(unsigned id, unsigned n) {
    auto label = std::string(names[id]) + char('0' + n);
    return esp_partition_find_first((esp_partition_type_t)0x40, ESP_PARTITION_SUBTYPE_ANY, label.c_str());
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
    std::string url = std::string(TRANSPORT_RELEASE_URL) + path;
    esp_http_client_config_t c{};
    c.url = url.c_str();
    c.cert_pem = ca;
    c.timeout_ms = 20000;
    c.disable_auto_redirect = true;
    c.buffer_size = 4096;
    Client h(esp_http_client_init(&c), esp_http_client_cleanup);
    length = -1;
    if (h && esp_http_client_open(h.get(), 0) == ESP_OK) {
        auto n = esp_http_client_fetch_headers(h.get());
        if (esp_http_client_get_status_code(h.get()) == 200 && n > 0 && n <= 0x300000)
            length = n;
    }
    return h;
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
    if (len < 1 || len > 16384) {
        note("Catalogue unavailable. Check Wi-Fi, clock and local server.");
        return false;
    }
    std::vector<char> bytes(len + 1);
    int read = esp_http_client_read_response(client.get(), bytes.data(), len);
    if (read != len) {
        note("Incomplete catalogue");
        return false;
    }
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
    std::array<Release, 3> verified{};
    for (unsigned i = 0; i < 3; i++) {
        auto e = cJSON_GetObjectItemCaseSensitive(entries, names[i]);
        if (!e && i == 2)
            continue;
        auto hash = cJSON_GetStringValue(cJSON_GetObjectItem(e, "sha256"));
        auto number = [&](const char *k, unsigned max) -> unsigned {
            auto p = cJSON_GetObjectItem(e, k);
            if (!cJSON_IsNumber(p) || p->valuedouble < 1 || p->valuedouble > max ||
                p->valuedouble != p->valueint)
                return 0;
            return p->valueint;
        };
        auto &r = verified[i];
        r.version = number("version", 0x7ffffffe);
        r.size = number("bytes", i == 2 ? 0x300000 : 0x270000);
        r.minCore = number("minCore", 0x7ffffffe);
        if (!hash || strlen(hash) != 64 || strspn(hash, "0123456789abcdef") != 64 || !r.size ||
            !r.minCore || !r.version) {
            note("Invalid release entry");
            return false;
        }
        r.hash = hash;
    }
    {
        std::lock_guard<std::mutex> lock(guard);
        catalog = verified;
    }
    note("Signed catalogue verified");
    return true;
}
bool install(unsigned id) {
    Release r;
    Library before;
    {
        std::lock_guard<std::mutex> l(guard);
        r = catalog[id];
        before = state;
    }
    if (!usable || !r.version || r.minCore > TRANSPORT_VERSION) {
        note("Install a compatible core first");
        return false;
    }
    unsigned old = id == 2 ? TRANSPORT_VERSION : before.versions[id][before.banks[id]];
    if (r.version <= old) {
        note("Already current");
        return false;
    }
    unsigned slot = id == 2 ? 0 : 1 - before.banks[id];
    auto part = id == 2 ? esp_ota_get_next_update_partition(nullptr) : bank(id, slot);
    int len = -1;
    auto client = get("/artifacts/" + r.hash + (id == 2 ? ".bin" : ".tda"), len);
    if (!part || len != int(r.size) || r.size > part->size) {
        note("Artifact size or slot mismatch");
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
            note(std::string("Downloading ") + names[id] + " " + std::to_string(reported * 10) + "%");
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
    esp_err_t rc = id == 2 ? esp_ota_begin(part, r.size, &ota)
                           : esp_partition_erase_range(part, 0, (r.size + 4095) & ~4095u);
    if (rc != ESP_OK) {
        note("Cannot prepare inactive slot");
        return false;
    }
    uint8_t block[4096];
    for (unsigned pos = 0; pos < off;) {
        unsigned n = std::min<unsigned>(sizeof block, off - pos);
        memcpy(block, image.get() + pos, n);
        rc = id == 2 ? esp_ota_write(ota, block, n) : esp_partition_write(part, pos, block, n);
        if (rc != ESP_OK) {
            if (id == 2)
                esp_ota_abort(ota);
            note("Flash write failed");
            return false;
        }
        pos += n;
    }
    ESP_LOGI("updates", "Programmed %u bytes in %lld ms", off, (esp_timer_get_time() - started) / 1000);
    if (id == 2) {
        esp_app_desc_t app{};
        if (esp_ota_end(ota) != ESP_OK || esp_ota_get_partition_description(part, &app) != ESP_OK ||
            strcmp(app.project_name, "transport_display") || std::to_string(r.version) != app.version ||
            esp_ota_set_boot_partition(part) != ESP_OK) {
            note("Core identity or image validation failed");
            return false;
        }
    } else {
        Library next = before;
        next.versions[id][slot] = r.version;
        next.pending = id;
        next.trialBank = slot;
        next.attempting = 0;
        std::lock_guard<std::mutex> lock(guard);
        if (!save(next)) {
            ESP_LOGE("updates", "Could not commit trial marker");
            return false;
        }
    }
    note("Verified download. Restarting for local checks.");
    esp_restart();
    return true;
}
void job(void *arg) {
    unsigned op = uintptr_t(arg);
    if (check() && op < 3)
        install(op);
    busy = false;
    vTaskDelete(nullptr);
}
lv_obj_t *summaryLabel;
} // namespace
void storageInit() {
    usable = nvs_open("transport", NVS_READWRITE, &handle) == ESP_OK;
    size_t n = sizeof state;
    Library stored;
    if (usable) {
        auto rc = nvs_get_blob(handle, "library", &stored, &n);
        if (rc == ESP_OK && n == sizeof stored && stored.format == 1 && stored.selected < 2 &&
            stored.pending <= 2 && stored.banks[0] < 2 && stored.banks[1] < 2 && stored.trialBank < 2)
            state = stored;
        else if (rc != ESP_ERR_NVS_NOT_FOUND)
            usable = false;
    }
    if (!usable) {
        note("App library unavailable");
        return;
    }
    if (state.pending < 2 && state.attempting) {
        auto next = state;
        next.pending = 2;
        next.attempting = 0;
        save(next);
        note("Recovered previous app after failed startup");
    }
}
bool mount() {
    if (!usable)
        return false;
    trial = state.pending < 2;
    unsigned id = trial ? state.pending : state.selected;
    unsigned slot = trial ? state.trialBank : state.banks[id];
    if (!state.versions[id][slot])
        return false;
    if (trial) {
        auto next = state;
        next.attempting = 1;
        if (!save(next))
            return false;
    }
    if (!openPackage(bank(id, slot), names[id], state.versions[id][slot])) {
        failedBoot();
        // A damaged committed bank may still have a usable predecessor.
        auto next = state;
        next.versions[id][slot] = 0;
        if (next.versions[id][1 - slot])
            next.banks[id] = 1 - slot;
        else if (next.versions[1 - id][next.banks[1 - id]])
            next.selected = 1 - id;
        if (save(next))
            esp_restart();
        return false;
    }
    running = id;
    return true;
}
void validated() {
    const auto *part = esp_ota_get_running_partition();
    esp_ota_img_states_t s;
    if (esp_ota_get_state_partition(part, &s) == ESP_OK && s == ESP_OTA_IMG_PENDING_VERIFY)
        ESP_ERROR_CHECK(esp_ota_mark_app_valid_cancel_rollback());
    if (trial && running < 2) {
        auto next = state;
        next.selected = running;
        next.banks[running] = next.trialBank;
        next.pending = 2;
        next.attempting = 0;
        if (!save(next))
            esp_restart();
    }
}
void failedBoot() {
    note("App validation failed");
    const auto *part = esp_ota_get_running_partition();
    esp_ota_img_states_t s;
    if (esp_ota_get_state_partition(part, &s) == ESP_OK && s == ESP_OTA_IMG_PENDING_VERIFY)
        esp_ota_mark_app_invalid_rollback_and_reboot();
    if (trial)
        esp_restart();
}
const char *activeApp() { return running < 2 ? names[running] : "recovery"; }
std::string status() {
    std::lock_guard<std::mutex> lock(guard);
    std::string s =
        "Running " + std::string(activeApp()) + " | Core v" + std::to_string(TRANSPORT_VERSION) + "\n";
    for (unsigned i = 0; i < 3; i++) {
        s += std::string(names[i]) + " v" +
             std::to_string(i == 2 ? TRANSPORT_VERSION : state.versions[i][state.banks[i]]);
        if (catalog[i].version)
            s += "   available v" + std::to_string(catalog[i].version) + " (" +
                 std::to_string(catalog[i].size) + " bytes)";
        s += "\n";
    }
    return s + message;
}
void action(const char *cmd) {
    if (busy.exchange(true))
        return;
    for (unsigned i = 0; i < 2; i++)
        if (std::string(cmd) == "open " + std::string(names[i])) {
            if (state.versions[i][state.banks[i]] && i != running) {
                Library next = state;
                next.pending = i;
                next.trialBank = state.banks[i];
                next.attempting = 0;
                if (save(next))
                    esp_restart();
            }
            busy = false;
            return;
        }
    unsigned op = 3;
    for (unsigned i = 0; i < 3; i++)
        if (std::string(cmd) == "install " + std::string(names[i]))
            op = i;
    if (op == 3 && strcmp(cmd, "check")) {
        busy = false;
        return;
    }
    note("Checking release server...");
    if (xTaskCreate(job, "release", 16384, (void *)(uintptr_t)op, 4, nullptr) != pdPASS) {
        busy = false;
        note("Insufficient update memory");
    }
}
void appsPage(lv_obj_t *parent) {
    summaryLabel = lv_label_create(parent);
    lv_label_set_text(summaryLabel, status().c_str());
    lv_obj_add_event_cb(
        summaryLabel, [](lv_event_t *) { summaryLabel = nullptr; }, LV_EVENT_DELETE, nullptr);
    static const char *labels[] = {"Check for updates", "Install Hemel", "Install Lakes",
                                   "Update core",       "Open Hemel",    "Open Lakes"};
    static const char *commands[] = {"check",        "install hemel", "install lakes",
                                     "install core", "open hemel",    "open lakes"};
    for (unsigned i = 0; i < 6; i++) {
        auto b = lv_button_create(parent);
        auto l = lv_label_create(b);
        lv_label_set_text(l, labels[i]);
        lv_obj_center(l);
        lv_obj_add_event_cb(
            b, [](lv_event_t *e) { action((const char *)lv_event_get_user_data(e)); }, LV_EVENT_CLICKED,
            (void *)commands[i]);
    }
}
void pollApps() {
    if (summaryLabel) {
        auto s = status();
        if (s != lv_label_get_text(summaryLabel))
            lv_label_set_text(summaryLabel, s.c_str());
    }
}
} // namespace transport
