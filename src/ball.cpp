#include "ball.h"

#include <algorithm>
#include <cmath>

namespace {
const int kBlock = 8;    // camera texels averaged per brightness cell
const int kSamples = 24; // probe points around the ball's edge
const int kSubsteps = 4;
const float kTau = 6.2831853f;
const float kShardBounce = 0.6f;
} // namespace

float Ball::rand01() {
    return std::uniform_real_distribution<float>(0.0f, 1.0f)(rng);
}

void Ball::reset(float width, float height) {
    radius = kSize * height;
    x = width * (0.2f + 0.6f * rand01());
    y = height + radius;
    vx = width * (rand01() - 0.5f) * 0.3f;
    vy = 0;
    squish = 0;
    alive = true;
    armed = false;
    placed = true;
}

void Ball::setFrame(const std::vector<uint8_t>& bgra, int w, int h) {
    gridW = w / kBlock;
    gridH = h / kBlock;
    if (gridW <= 0 || gridH <= 0) return;
    cameraAspect = float(w) / float(h);
    luma.resize(size_t(gridW) * gridH);
    for (int gy = 0; gy < gridH; gy++) {
        for (int gx = 0; gx < gridW; gx++) {
            float sum = 0;
            for (int by = 0; by < kBlock; by++) {
                const uint8_t* p = &bgra[(size_t(gy * kBlock + by) * w + gx * kBlock) * 4];
                for (int bx = 0; bx < kBlock; bx++, p += 4)
                    sum += 0.114f * p[0] + 0.587f * p[1] + 0.299f * p[2];
            }
            luma[size_t(gy) * gridW + gx] = sum / (kBlock * kBlock * 255.0f);
        }
    }
}

bool Ball::solidAt(float px, float py, float width, float height) const {
    if (luma.empty()) return false;
    // Same screen-to-camera mapping as cameraAt() in shaders/ball.frag:
    // scale to cover the window, mirror horizontally, rows top-down.
    float cx = px / width - 0.5f;
    float cy = py / height - 0.5f;
    float screenAspect = width / height;
    if (screenAspect > cameraAspect) cy *= cameraAspect / screenAspect;
    else cx *= screenAspect / cameraAspect;
    int gx = int((0.5f - cx) * gridW);
    int gy = int((0.5f - cy) * gridH);
    if (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH) return false;
    return luma[size_t(gy) * gridW + gx] >= kSolid;
}

// A hit at `speed` along the unit axis (ax, ay) flattens the ball briefly.
// Capped below kPop: impacts alone never burst it, only squeezing does.
void Ball::bump(float speed, float ax, float ay, float height) {
    float s = std::min(0.45f, speed / (2.5f * height));
    if (s > squish) {
        squish = s;
        squishX = ax;
        squishY = ay;
    }
}

void Ball::pop(float height) {
    for (int i = 0; i < kMaxShards; i++) {
        float a = kTau * rand01();
        float speed = (0.4f + 1.2f * rand01()) * height;
        float r = radius * rand01();
        shards.push_back({x + std::cos(a) * r, y + std::sin(a) * r,
                          std::cos(a) * speed + 0.5f * vx, std::sin(a) * speed + 0.5f * vy, 1.0f});
    }
    alive = false;
    respawnIn = kRespawn;
}

void Ball::stepShards(float h, float width, float height) {
    for (Shard& s : shards) {
        s.vy -= kGravity * height * h;
        float nx = s.x + s.vx * h, ny = s.y + s.vy * h;
        // Bounce off bright areas one axis at a time. A shard already inside
        // brightness passes through rather than getting stuck.
        if (!solidAt(s.x, s.y, width, height)) {
            if (solidAt(nx, s.y, width, height)) { s.vx *= -kShardBounce; nx = s.x; }
            if (solidAt(nx, ny, width, height)) { s.vy *= -kShardBounce; ny = s.y; }
        }
        s.x = nx;
        s.y = ny;
        if (s.x < 0) { s.x = 0; s.vx = std::fabs(s.vx) * kShardBounce; }
        if (s.x > width) { s.x = width; s.vx = -std::fabs(s.vx) * kShardBounce; }
        if (s.y < 0) {
            s.y = 0;
            s.vy = std::fabs(s.vy) * kShardBounce;
            s.vx *= 1.0f - 2.0f * h; // floor friction
        }
        s.life -= h / kShardLife;
    }
    std::erase_if(shards, [](const Shard& s) { return s.life <= 0; });
}

void Ball::stepBall(float h, float width, float height) {
    vy -= kGravity * height * h;
    x += vx * h;
    y += vy * h;

    // Probe the ball's edge. Probes inside a bright area push the ball away
    // from that side; those and probes touching a wall count as contacts for
    // working out how squeezed the ball is.
    float nx = 0, ny = 0;         // push direction from bright probes
    float cx = 0, cy = 0;         // same, over all contacts
    float sxx = 0, sxy = 0, syy = 0;
    int hits = 0, contacts = 0;
    float margin = 0.12f * radius;
    for (int i = 0; i < kSamples; i++) {
        float a = kTau * float(i) / kSamples;
        float dx = std::cos(a), dy = std::sin(a);
        float px = x + dx * radius, py = y + dy * radius;
        bool bright = armed && solidAt(px, py, width, height);
        bool wall = px < margin || px > width - margin || py < margin;
        if (bright) {
            nx -= dx;
            ny -= dy;
            hits++;
        }
        if (bright || wall) {
            cx -= dx;
            cy -= dy;
            sxx += dx * dx;
            sxy += dx * dy;
            syy += dy * dy;
            contacts++;
        }
    }

    // A new ball falls through brightness until it is on screen and clear of it,
    // so a bright patch at the top cannot trap or burst it on arrival.
    if (!armed && y < height - radius) {
        bool clear = true;
        for (int i = 0; i < kSamples && clear; i++) {
            float a = kTau * float(i) / kSamples;
            clear = !solidAt(x + std::cos(a) * radius, y + std::sin(a) * radius, width, height);
        }
        armed = clear;
    }

    float len = std::hypot(nx, ny);
    if (hits > 0 && len > 1e-3f) {
        nx /= len;
        ny /= len;
        float depth = float(hits) / kSamples;
        float vn = vx * nx + vy * ny;
        if (vn < 0) {
            bump(-vn, nx, ny, height);
            vx -= (1 + kBounce) * vn * nx;
            vy -= (1 + kBounce) * vn * ny;
        }
        vx += nx * kPush * height * depth * h;
        vy += ny * kPush * height * depth * h;
        x += nx * radius * depth * 0.25f;
        y += ny * radius * depth * 0.25f;
    }

    if (x < radius) { x = radius; bump(std::fabs(vx), 1, 0, height); vx = std::fabs(vx) * kBounce; }
    if (x > width - radius) { x = width - radius; bump(std::fabs(vx), 1, 0, height); vx = -std::fabs(vx) * kBounce; }
    if (y < radius) { y = radius; bump(std::fabs(vy), 0, 1, height); vy = std::fabs(vy) * kBounce; }
    // The ceiling only stops a rising ball, so a new one can drop in from above.
    if (y > height - radius && vy > 0) { y = height - radius; bump(vy, 0, 1, height); vy = -vy * kBounce; }

    float speed = std::hypot(vx, vy), limit = kMaxSpeed * height;
    if (speed > limit) {
        vx *= limit / speed;
        vy *= limit / speed;
    }

    // Pressure is high when contacts surround the ball and oppose each other
    // (pinched), and near zero when they all sit on one side (just resting).
    float pressure = 0;
    if (contacts > 0) {
        float coverage = float(contacts) / kSamples;
        float oneSided = std::hypot(cx, cy) / contacts;
        pressure = coverage * (1.0f - oneSided);
    }
    float target = std::clamp((pressure - 0.12f) / 0.33f, 0.0f, 1.0f);
    if (target > squish) {
        // Flatten along the direction most contacts lie in.
        float a = 0.5f * std::atan2(2.0f * sxy, sxx - syy);
        squishX = std::cos(a);
        squishY = std::sin(a);
    }
    squish += (target - squish) * std::min(1.0f, 12.0f * h);

    if (armed && squish >= kPop) pop(height);
}

void Ball::step(float dt, float width, float height) {
    if (width <= 0 || height <= 0) return;
    radius = kSize * height;
    if (!placed) reset(width, height);

    float h = std::min(dt, 1.0f / 30.0f) / kSubsteps;
    for (int s = 0; s < kSubsteps; s++) {
        stepShards(h, width, height);
        if (alive) {
            stepBall(h, width, height);
        } else {
            respawnIn -= h;
            if (respawnIn <= 0) reset(width, height);
        }
    }
}
