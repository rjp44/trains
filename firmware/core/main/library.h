#pragma once
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <vector>

namespace transport {
// The original four data partitions remain in place. Each extent fits inside one partition.
constexpr unsigned sectorBytes = 4096, bankSectors = 0x270000 / sectorBytes, bankCount = 4;
constexpr uint16_t none = 0xffff;
struct Extent {
    uint16_t start = none, pages = 0;
};
struct Item {
    Extent file, previous;
    bool candidate = false;
};
struct Library {
    uint16_t selected = none, pending = none;
    bool attempted = false;
    std::vector<Item> items;
    Item *at(uint16_t start) {
        auto it =
            std::find_if(items.begin(), items.end(), [&](const auto &i) { return i.file.start == start; });
        return it == items.end() ? nullptr : &*it;
    }
    void remove(uint16_t start) {
        items.erase(std::remove_if(items.begin(), items.end(),
                                   [&](const auto &i) { return i.file.start == start; }),
                    items.end());
        if (selected == start)
            selected = none;
        if (pending == start) {
            pending = none;
            attempted = false;
        }
    }
    void reject() {
        auto *i = at(pending);
        if (i && i->candidate) {
            if (i->previous.pages) {
                if (selected == pending)
                    selected = i->previous.start;
                *i = {i->previous, {}, false};
            } else
                remove(pending);
        }
        pending = none;
        attempted = false;
    }
    void confirm() {
        if (auto *i = at(pending)) {
            selected = pending;
            i->previous = {};
            i->candidate = false;
        }
        pending = none;
        attempted = false;
    }
    std::vector<Extent> occupied() const {
        std::vector<Extent> v;
        for (auto &i : items) {
            v.push_back(i.file);
            if (i.previous.pages)
                v.push_back(i.previous);
        }
        std::sort(v.begin(), v.end(), [](Extent a, Extent b) { return a.start < b.start; });
        return v;
    }
    unsigned freeBytes() const {
        unsigned used = 0;
        for (auto i : items)
            used += i.file.pages + i.previous.pages;
        return (bankCount * bankSectors - used) * sectorBytes;
    }
    Extent allocate(unsigned bytes) const {
        unsigned pages = (bytes + sectorBytes - 1) / sectorBytes;
        if (!pages || pages > bankSectors)
            return {};
        auto used = occupied();
        for (unsigned b = 0; b < bankCount; b++) {
            unsigned cursor = b * bankSectors, end = cursor + bankSectors;
            for (auto e : used) {
                if (e.start < cursor)
                    continue;
                if (e.start >= end)
                    break;
                if (pages <= e.start - cursor)
                    return {uint16_t(cursor), uint16_t(pages)};
                cursor = e.start + e.pages;
            }
            if (pages <= end - cursor)
                return {uint16_t(cursor), uint16_t(pages)};
        }
        return {};
    }
    std::vector<uint16_t> encode() const {
        std::vector<uint16_t> v{2, selected, pending, uint16_t(attempted)};
        for (auto i : items)
            v.insert(v.end(), {i.file.start, i.file.pages, i.previous.start, i.previous.pages,
                               uint16_t(i.candidate)});
        return v;
    }
    bool decode(const std::vector<uint16_t> &v) {
        if (v.size() < 4 || v[0] != 2 || (v.size() - 4) % 5 || v[3] > 1)
            return false;
        Library n;
        n.selected = v[1];
        n.pending = v[2];
        n.attempted = v[3];
        for (size_t j = 4; j < v.size(); j += 5) {
            if (!v[j + 1] || v[j + 4] > 1 || (!v[j + 3] && v[j + 2] != none))
                return false;
            n.items.push_back({{v[j], v[j + 1]}, {v[j + 2], v[j + 3]}, bool(v[j + 4])});
        }
        unsigned end = 0;
        for (auto e : n.occupied()) {
            if (e.start < end || e.start >= bankCount * bankSectors ||
                e.pages > bankSectors - e.start % bankSectors)
                return false;
            end = e.start + e.pages;
        }
        if ((n.selected != none && !n.at(n.selected)) || (n.pending != none && !n.at(n.pending)) ||
            (n.attempted && n.pending == none))
            return false;
        *this = std::move(n);
        return true;
    }
};
} // namespace transport
