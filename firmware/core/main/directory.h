#pragma once
#include <string>
#include <vector>
namespace transport {
struct Listing {
    std::string id, name, description, adapter, hash;
    unsigned version{}, size{}, minCore{}, installed{}, used{};
    bool fits{}, compatible{};
};
struct Directory {
    std::vector<Listing> apps;
    std::string message;
    unsigned free{}, capacity{};
    bool busy{}, updateCore{};
};
unsigned directoryRevision();
Directory directory();
std::string sourceCredits();
} // namespace transport
