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
    unsigned free{}, capacity{}, updateCore{};
    bool busy{};
};
unsigned directoryRevision();
void requestDirectoryCheck();
void pollDirectoryCheck();
Directory directory();
std::string sourceCredits();
std::string installedVersions();
} // namespace transport
