#include "panel.h"
#include "input.h"
#include <array>
#include <charconv>
#include <string>

namespace hemel {
namespace {
using input::Field;
std::string line, packet;
bool dropping = false, synced = false;
uint32_t lastSeq = 0, received = 0;

bool number(Field field, uint32_t &value) {
    auto end = field.data() + field.size();
    auto parsed = std::from_chars(field.data(), end, value);
    return parsed.ec == std::errc{} && parsed.ptr == end;
}
unsigned fields(Field line, std::array<Field, 8> &out) {
    unsigned count = 0;
    while (count < out.size()) {
        const auto pos = line.find('\t');
        out[count++] = line.substr(0, pos);
        if (pos == Field::npos)
            return count;
        line.remove_prefix(pos + 1);
    }
    return 0;
}
uint32_t checksum(Field bytes) {
    uint32_t crc = ~0u;
    for (unsigned char c : bytes) {
        crc ^= c;
        for (int i = 0; i < 8; ++i)
            crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1)));
    }
    return ~crc;
}
bool rows(Field remaining, bool apply) {
    while (!remaining.empty()) {
        auto end = remaining.find('\n');
        if (end == Field::npos)
            return false;
        std::array<Field, 8> f;
        unsigned count = fields(remaining.substr(0, end), f);
        remaining.remove_prefix(end + 1);
        uint32_t i, aspect, kind, identity;
        if (count < 2 || !number(f[1], i))
            return false;
        if (f[0] == "M") {
            if (count != 8 || i >= input::markers() || !number(f[2], aspect) || aspect > 2 ||
                !number(f[3], kind) || kind > 3 || (kind == 0) != f[4].empty() || f[4].size() > 12 ||
                f[5].size() > 24 || f[6].size() > 128 || f[7].size() > 128)
                return false;
            if (apply)
                input::marker(i, aspect, kind, &f[4]);
        } else if (f[0] == "C") {
            if (count != 7 || i >= 4 || !number(f[6], identity) || (identity == 0) != f[2].empty() ||
                f[2].size() > 12 || f[3].size() > 128 || f[4].size() > 128 || f[5].size() > 128)
                return false;
            if (apply)
                input::card(i, &f[2], identity);
        } else
            return false;
    }
    return true;
}
bool commit(Field trailer, uint32_t now) {
    Field bytes = packet;
    auto end = bytes.find('\n');
    if (end == Field::npos)
        return false;
    std::array<Field, 8> header;
    uint32_t expected, layout, sequence, status, observed;
    if (!number(trailer, expected) || checksum(bytes) != expected ||
        fields(bytes.substr(0, end), header) != 6 || header[0] != "@H1" || !number(header[1], layout) ||
        layout != input::fingerprint() || !number(header[2], sequence) || !sequence ||
        !number(header[4], status) || status > 4 || !number(header[5], observed))
        return false;
    const bool full = header[3] == "F";
    if (!full && (header[3] != "D" || !synced || sequence != lastSeq + 1))
        return false;
    bytes.remove_prefix(end + 1);
    if (!rows(bytes, false))
        return false;
    input::startFrame(full);
    rows(bytes, true);
    input::finishFrame(status, observed, now);
    synced = true;
    lastSeq = sequence;
    received = now;
    return true;
}
void lost() {
    synced = false;
    if (isLive())
        input::stale();
}
void readLine(Field s, uint32_t now) {
    if (s.substr(0, 4) == "@H1\t") {
        if (!packet.empty())
            lost();
        packet.assign(s);
        packet += '\n';
        return;
    }
    if (s.substr(0, 2) == "T\t" && packet.empty()) {
        std::array<Field, 8> f;
        uint32_t x, y;
        if (fields(s, f) == 3 && number(f[1], x) && number(f[2], y) && x < unsigned(width()) &&
            y < unsigned(height())) {
            pointer(x, y, true);
            pointer(x, y, false);
        }
        return;
    }
    if (packet.empty())
        return;
    if (!s.empty() && s.front() == '!') {
        if (!commit(s.substr(1), now))
            lost();
        packet.clear();
        return;
    }
    if (packet.size() + s.size() + 1 > 65536) {
        packet.clear();
        lost();
        return;
    }
    packet.append(s);
    packet += '\n';
}
} // namespace
void feedInput(const char *data, size_t length, uint32_t now) {
    for (size_t i = 0; i < length; ++i) {
        const unsigned char c = data[i];
        if (c == '\n') {
            if (!dropping)
                readLine(line, now);
            line.clear();
            dropping = false;
        } else if (!dropping) {
            if ((c != '\t' && (c < 32 || c > 126)) || line.size() >= 520) {
                dropping = true;
                line.clear();
                packet.clear();
                lost();
            } else
                line.push_back(char(c));
        }
    }
}
void linkEnded() {
    packet.clear();
    line.clear();
    dropping = false;
    lost();
}
void input::forgetSequence() { synced = false; }
void updateLive(uint32_t now) {
    if (synced && now - received >= 6500)
        lost();
    if (isLive())
        refreshCards(now);
}
} // namespace hemel
