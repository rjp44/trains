#pragma once
#include "package.h"
#include <cmath>
#include <limits>
#include <type_traits>
namespace transport {
inline const cJSON *field(const cJSON *o, const char *k) { return cJSON_GetObjectItemCaseSensitive(o, k); }
template <class T> bool value(const cJSON *p, T &out) {
    if constexpr (std::is_same_v<T, const char *>) {
        if (!cJSON_IsString(p))
            return false;
        out = p->valuestring;
    } else {
        if (!cJSON_IsNumber(p) || !std::isfinite(p->valuedouble))
            return false;
        double d = p->valuedouble;
        if (d < std::numeric_limits<T>::lowest() || d > std::numeric_limits<T>::max() ||
            (std::is_integral_v<T> && std::trunc(d) != d))
            return false;
        out = static_cast<T>(d);
    }
    return true;
}
template <class... T> bool row(const cJSON *p, T &...out) {
    if (!cJSON_IsArray(p))
        return false;
    auto *next = p->child;
    auto take = [&](auto &item) {
        if (!next || !value(next, item))
            return false;
        next = next->next;
        return true;
    };
    return (take(out) && ...) && !next;
}
template <class T, class F>
bool load(const char *k, std::vector<T> &dest, F convert, size_t limit = 65535) {
    auto *p = field(tables, k);
    if (!cJSON_IsArray(p))
        return false;
    int n = cJSON_GetArraySize(p);
    if (n < 1 || size_t(n) > limit)
        return false;
    dest.resize(n);
    size_t i = 0;
    for (auto *v = p->child; v; v = v->next)
        if (!convert(v, dest[i++]))
            return false;
    return true;
}
} // namespace transport
