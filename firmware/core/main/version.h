#pragma once
#include <string>

namespace transport {
inline std::string versionLabel(unsigned code) {
    if (code < 9000)
        return "build " + std::to_string(code);
    return "v" + std::to_string(code / 1000000) + "." + std::to_string(code / 1000 % 1000) + "." +
           std::to_string(code % 1000);
}
} // namespace transport
