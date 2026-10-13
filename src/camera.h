#pragma once

#include <cstdint>
#include <memory>
#include <vector>

// Default webcam, delivered as tightly packed BGRA rows, top row first.
class Camera {
public:
    Camera();
    ~Camera();

    // Asks for camera access if needed and begins capturing. Returns at once;
    // frames start arriving once access is granted.
    void start();

    // Swaps the newest frame into `bgra`. Returns false if nothing new arrived.
    bool poll(std::vector<uint8_t>& bgra, int& width, int& height);

private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
