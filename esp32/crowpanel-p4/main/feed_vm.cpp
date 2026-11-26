#include "feed_vm.h"
#include "package.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_rom_crc.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <ctime>
#include <cstdlib>

extern const char script[] asm("_binary_board_feed_js_start");
extern const char scriptEnd[] asm("_binary_board_feed_js_end");

namespace {
constexpr uint32_t caps = MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT;
const JSMallocFunctions mem = {
    [](void *, size_t n, size_t size) { return heap_caps_calloc(n, size, caps); },
    [](void *, size_t size) { return heap_caps_malloc(size, caps); },
    [](void *, void *p) { heap_caps_free(p); },
    [](void *, void *p, size_t size) { return heap_caps_realloc(p, size, caps); },
    [](const void *p) -> size_t { return p ? heap_caps_get_allocated_size(const_cast<void *>(p)) : 0; },
};
// A long timetable can keep the interpreter busy for seconds on the P4.
int yieldInterpreter(JSRuntime *, void *opaque) {
    auto &next = *static_cast<int64_t *>(opaque);
    const auto now = esp_timer_get_time();
    if (now >= next) {
        vTaskDelay(1);
        next = esp_timer_get_time() + 50000;
    }
    return 0;
}
JSValue crc(JSContext *ctx, JSValueConst, int argc, JSValueConst *args) {
    size_t len;
    const char *s = argc ? JS_ToCStringLen(ctx, &len, args[0]) : nullptr;
    if (!s) return JS_EXCEPTION;
    uint32_t sum = esp_rom_crc32_le(0, reinterpret_cast<const uint8_t *>(s), len);
    JS_FreeCString(ctx, s);
    return JS_NewUint32(ctx, sum);
}
JSValue londonDay(JSContext *ctx, JSValueConst, int argc, JSValueConst *args) {
    int64_t ms;
    if (!argc || JS_ToInt64(ctx, &ms, args[0])) return JS_EXCEPTION;
    time_t seconds = ms/1000;
    struct tm day;
    char result[12];
    localtime_r(&seconds, &day);
    strftime(result, sizeof(result), "%d/%m/%y", &day);
    return JS_NewString(ctx, result);
}
}

FeedVM::~FeedVM() {
    if (ctx) { JS_FreeValue(ctx, api); JS_FreeContext(ctx); }
    if (rt) JS_FreeRuntime(rt);
}
void FeedVM::check(JSValue value) {
    if (!JS_IsException(value)) return;
    ok = false;
    JSValue exc = JS_GetException(ctx);
    const char *error = JS_ToCString(ctx, exc);
    ESP_LOGW("feed", "Projection failed: %.120s", error ? error : "no memory");
    JS_FreeCString(ctx, error);
    JS_FreeValue(ctx, exc);
}
bool FeedVM::init() {
    setenv("TZ", "GMT0BST,M3.5.0/1,M10.5.0/2", 1);
    tzset();
    rt = JS_NewRuntime2(&mem, nullptr);
    if (!rt) return false;
    JS_SetInterruptHandler(rt, yieldInterpreter, &nextYield);
    JS_SetMemoryLimit(rt, 12 * 1024 * 1024);
    JS_SetMaxStackSize(rt, 80 * 1024);
    ctx = JS_NewContext(rt);
    if (!ctx) return false;
    JSValue global = JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx, global, "panelCRC", JS_NewCFunction(ctx, crc, "crc32", 1));
    JS_SetPropertyStr(ctx, global, "londonDate", JS_NewCFunction(ctx, londonDay, "londonDate", 1));
    auto& layout=transport::corridor;
    JSValue data=JS_ParseJSON(ctx,(const char*)layout.data,layout.size,"corridor.json");
    check(data);
    JS_SetPropertyStr(ctx,global,"transportCorridor",data);
    JSValue loaded = JS_Eval(ctx, script, scriptEnd - script - 1, "board_feed.js", JS_EVAL_TYPE_GLOBAL);
    check(loaded);
    JS_FreeValue(ctx, loaded);
    api = JS_GetPropertyStr(ctx, global, "railFeed");
    JS_FreeValue(ctx, global);
    if (ok) call("start");
    return ok;
}
JSValue FeedVM::invoke(const char *method, JSValue arg) {
    JSValue fn = JS_GetPropertyStr(ctx, api, method);
    JSValue value = JS_Call(ctx, fn, api, 1, &arg);
    JS_FreeValue(ctx, fn);
    JS_FreeValue(ctx, arg);
    check(value);
    JSContext *jobCtx;
    int status;
    do { status = JS_ExecutePendingJob(rt, &jobCtx); } while (status > 0);
    if (status < 0) check(JS_EXCEPTION);
    return value;
}
int FeedVM::tick() {
    JSValue value = invoke("tick", JS_UNDEFINED);
    int32_t id = 0;
    if (ok) JS_ToInt32(ctx, &id, value);
    JS_FreeValue(ctx, value);
    return id;
}
std::string FeedVM::call(const char *method, const std::string *text, bool flag) {
    JSValue value = invoke(method, text ? JS_NewStringLen(ctx, text->data(), text->size()) : JS_NewBool(ctx, flag));
    std::string out;
    if (ok && JS_IsString(value)) {
        size_t n;
        const char *chars = JS_ToCStringLen(ctx, &n, value);
        if (chars) out.assign(chars, n);
        else ok = false;
        JS_FreeCString(ctx, chars);
    }
    JS_FreeValue(ctx, value);
    return out;
}
