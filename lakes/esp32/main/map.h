#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace lakes {
constexpr int panelWidth = 1024, panelHeight = 600;
struct Vehicle {
    std::string id, label, destination, origin, terminus, departure, serviceDate;
    std::string last, lastCode, next, nextCode, lastTime, nextTime;
    int lastStop = -1; // Unknown on older feed responses.
    int route = -1, direction = 0;
    double x = 0, y = 0, bearing = -1;
    int path = -1;
    float along = 0;
    int64_t time = 0;
};
struct Snapshot {
    uint32_t link = 0;
    int64_t time = 0;
    bool busOk = false, railOk = false;
    std::vector<Vehicle> vehicles;
};
int routeIndex(const char *name);
void project(double lon, double lat, double &x, double &y);
bool decode(const char *body, Snapshot &snapshot);
void init();
void initFeedQueue();
void consumeFeed(uint32_t now);
void receive(Snapshot snapshot, uint32_t now);
void failed();
void render(uint16_t *target, uint32_t now);
void requestRedraw();
std::string status();
bool needsRender(uint32_t now);
void dismissDetails(uint32_t now);
bool scrollDetails(int startX, int startY, int dy);
void toggleTheme();
void pinch(float ratio, int fromX, int fromY, int toX, int toY);
void finishPinch();
void gesture(int x, int y, int dx, int dy, uint32_t now);
int visibleCount();
void replayInput(const char *json);
} // namespace lakes
