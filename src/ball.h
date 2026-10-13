#pragma once

#include <cstdint>
#include <random>
#include <vector>

// A bouncing ball that treats bright areas of the camera image as solid.
// Squeezing it between bright areas, or against a wall, flattens it; squeeze
// hard enough and it pops into shards, and a new ball drops in from the top.
// Positions are framebuffer pixels with the origin at the bottom-left.
struct Ball {
    static constexpr float kSolid = 0.62f;   // camera brightness (0..1) that counts as solid
    static constexpr float kGravity = 2.0f;  // window heights per second squared
    static constexpr float kBounce = 0.75f;  // speed kept after a bounce
    static constexpr float kPush = 14.0f;    // how hard bright areas shove the ball away
    static constexpr float kMaxSpeed = 3.5f; // window heights per second
    static constexpr float kSize = 0.045f;   // radius as a fraction of window height

    static constexpr float kPop = 0.8f;       // squish (0..1) at which the ball bursts
    static constexpr float kRespawn = 1.2f;   // seconds from a pop to the next ball
    static constexpr float kShardLife = 2.4f; // seconds a shard lasts
    static constexpr int kMaxShards = 32;

    struct Shard {
        float x, y, vx, vy;
        float life; // 1 when created, 0 when gone
    };

    float x = 0, y = 0, vx = 0, vy = 0, radius = 0;
    float squish = 0;               // 0 = round, 1 = flat
    float squishX = 1, squishY = 0; // unit axis the ball is flattened along
    bool alive = false;             // false between a pop and the next drop
    std::vector<Shard> shards;

    // Drops a fresh ball from above the top edge of a width x height window.
    void reset(float width, float height);

    // Takes a camera frame: tightly packed BGRA rows, top row first.
    void setFrame(const std::vector<uint8_t>& bgra, int w, int h);

    // Advances the simulation by dt seconds inside a width x height window.
    void step(float dt, float width, float height);

private:
    bool solidAt(float px, float py, float width, float height) const;
    void stepBall(float h, float width, float height);
    void stepShards(float h, float width, float height);
    void bump(float speed, float ax, float ay, float height);
    void pop(float height);
    float rand01();

    std::vector<float> luma; // camera brightness averaged over kBlock x kBlock texels
    int gridW = 0, gridH = 0;
    float cameraAspect = 1;
    bool placed = false;
    bool armed = false; // a new ball ignores brightness until it has been clear of it
    float respawnIn = 0;
    std::minstd_rand rng{12345};
};
