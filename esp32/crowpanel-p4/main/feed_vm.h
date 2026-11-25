#pragma once
#include <string>
#include "quickjs.h"

class FeedVM {
public:
    ~FeedVM();
    bool init();
    bool ok = true;
    int tick();
    std::string call(const char *method, const std::string *text = nullptr, bool flag = false);
private:
    JSRuntime *rt = nullptr;
    JSContext *ctx = nullptr;
    JSValue api = JS_UNDEFINED;
    JSValue invoke(const char *method, JSValue argument);
    void check(JSValue result);
};
