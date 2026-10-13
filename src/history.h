#pragma once

#include <cstdint>
#include <vector>

// The most recent camera frames, downscaled, kept as layers of a texture
// array so a shader can look back in time. Layers form a ring: head() is the
// newest, head() - 1 the one before it, wrapping around kLayers.
class FrameHistory {
public:
    static constexpr int kLayers = 128; // about 4 seconds at 30 fps
    static constexpr int kWidth = 320;  // frames are shrunk to roughly this width

    // Binds the texture array to texture unit `unit`, creating it on first use.
    void bind(int unit);

    // Stores a frame (tightly packed BGRA rows, top row first) as the newest layer.
    void push(const std::vector<uint8_t>& bgra, int w, int h, int unit);

    int head() const { return head_; }
    int count() const { return count_; } // layers holding a real frame

private:
    void allocate(int w, int h);

    unsigned texture = 0;
    int width = 0, height = 0;
    int head_ = 0, count_ = 0;
    std::vector<uint8_t> small;
};
