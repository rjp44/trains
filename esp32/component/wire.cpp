#include "panel.h"
#include "input.h"
#include <array>
#include <algorithm>
#include <charconv>
#include <string>

namespace hemel {
namespace {
using input::Field;
std::string line, packet;
bool dropping = false, synced = false;
std::array<uint32_t, 16> recentArrivals{};
unsigned nextArrival = 0;
uint32_t lastSeq = 0, received = 0, frameCrc = 0;
bool acceptArrival = false;
uint32_t stopEvent = 0, stopMask = 0;
void (*arrivalHandler)(Direction, bool) = nullptr;

bool number(Field field, uint32_t &value) {
    auto end = field.data() + field.size();
    auto parsed = std::from_chars(field.data(), end, value);
    return parsed.ec == std::errc{} && parsed.ptr == end;
}
template <size_t N> unsigned fields(Field line, std::array<Field, N> &out) {
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
        std::array<Field, 9> f{};
        unsigned count = fields(remaining.substr(0, end), f);
        remaining.remove_prefix(end + 1);
        uint32_t i, aspect, kind, identity;
        if (count < 2 || !number(f[1], i))
            return false;
        if (f[0] == "M") {
            if ((count != 8 && count != 9) || i >= input::markers() || !number(f[2], aspect) || aspect > 2 ||
                !number(f[3], kind) || kind > 3 || (kind == 0) != f[4].empty() || f[4].size() > 12 ||
                f[5].size() > 24 || f[6].size() > 128 || f[7].size() > 128 ||
                (count == 9 && ((f[8].size() != 3 && f[8].size() != 5) || f[5].empty() ||
                                f[8].find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZ") != Field::npos)))
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
    const bool continuous = synced && now - received < 6500 && sequence == lastSeq + 1;
    input::startFrame(full);
    rows(bytes, true);
    input::finishFrame(status, observed, now);
    acceptArrival = continuous && (status == 1 || status == 2);
    frameCrc = expected;
    synced = true;
    lastSeq = sequence;
    received = now;
    return true;
}
void lost() {
    stopMask = 0;
    acceptArrival = false;
    synced = false;
    if (isLive())
        input::stale();
}
void readLine(Field s, uint32_t now) {
    if (s.substr(0, 3) == "S1\t" && packet.empty()) {
        std::array<Field, 8> f;
        uint32_t crc, mask;
        stopMask = 0;
        if (fields(s, f) == 4 && number(f[1], stopEvent) && number(f[2], mask) && mask < 256 &&
            number(f[3], crc) && crc == checksum(s.substr(0, s.rfind('\t'))))
            stopMask = mask;
        return;
    }
    if (acceptArrival) {
        acceptArrival = false;
        if (s.substr(0, 3) == "A1\t" && now - received < 1500) {
            std::array<Field, 8> f;
            uint32_t seq, batch, crc;
            if (fields(s, f) == 5 && number(f[1], seq) && seq == lastSeq &&
                number(f[2], batch) && batch == frameCrc && !f[3].empty() && f[3].size() <= 8 &&
                f[3].find_first_not_of("DU") == Field::npos &&
                number(f[4], crc) && crc == checksum(s.substr(0, s.rfind('\t'))) && arrivalHandler &&
                std::find(recentArrivals.begin(), recentArrivals.end(), crc) == recentArrivals.end()) {
                recentArrivals[nextArrival++ % recentArrivals.size()] = crc;
                for (size_t i = 0; i < f[3].size(); ++i)
                    arrivalHandler(f[3][i] == 'D' ? Direction::Down : Direction::Up,
                                   stopEvent == crc && (stopMask & (1u << i)));
                stopMask = 0;
            }
            return;
        }
    }
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
void feedInput(const char *data, size_t length, uint32_t now, LocalCommand provision) {
    for (size_t i = 0; i < length; ++i) {
        const unsigned char c = data[i];
        if (c == '\n') {
            if (!dropping) {
                if (provision && line.compare(0, 3, "W1\t") == 0)
                    provision(line);
                else
                    readLine(line, now);
            }
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
void input::forgetSequence() { synced = acceptArrival = false; }
void setArrivalHandler(void (*handler)(Direction, bool)) { arrivalHandler = handler; }
void updateLive(uint32_t now) {
    if (synced && now - received >= 6500)
        lost();
    if (isLive())
        refreshCards(now);
}
} // namespace hemel
