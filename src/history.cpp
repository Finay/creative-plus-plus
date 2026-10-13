#include "history.h"

#define GLFW_INCLUDE_GLCOREARB
#include <GLFW/glfw3.h>

#include <algorithm>

void FrameHistory::allocate(int w, int h) {
    width = w;
    height = h;
    head_ = 0;
    count_ = 0;
    std::vector<uint8_t> black(size_t(w) * h * kLayers * 4, 0);
    glTexImage3D(GL_TEXTURE_2D_ARRAY, 0, GL_RGBA8, w, h, kLayers, 0, GL_BGRA, GL_UNSIGNED_BYTE, black.data());
}

void FrameHistory::bind(int unit) {
    glActiveTexture(GL_TEXTURE0 + unit);
    if (!texture) {
        glGenTextures(1, &texture);
        glBindTexture(GL_TEXTURE_2D_ARRAY, texture);
        glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        allocate(1, 1);
    } else {
        glBindTexture(GL_TEXTURE_2D_ARRAY, texture);
    }
    glActiveTexture(GL_TEXTURE0);
}

void FrameHistory::push(const std::vector<uint8_t>& bgra, int w, int h, int unit) {
    // Shrink by a whole factor with a box filter.
    int f = std::max(1, w / kWidth);
    int sw = w / f, sh = h / f;
    if (sw <= 0 || sh <= 0) return;
    small.resize(size_t(sw) * sh * 4);
    for (int y = 0; y < sh; y++) {
        for (int x = 0; x < sw; x++) {
            unsigned sum[4] = {0, 0, 0, 0};
            for (int by = 0; by < f; by++) {
                const uint8_t* p = &bgra[(size_t(y * f + by) * w + x * f) * 4];
                for (int bx = 0; bx < f; bx++, p += 4)
                    for (int c = 0; c < 4; c++) sum[c] += p[c];
            }
            uint8_t* q = &small[(size_t(y) * sw + x) * 4];
            for (int c = 0; c < 4; c++) q[c] = uint8_t(sum[c] / unsigned(f * f));
        }
    }

    bind(unit);
    glActiveTexture(GL_TEXTURE0 + unit);
    if (sw != width || sh != height) allocate(sw, sh);
    head_ = count_ ? (head_ + 1) % kLayers : 0;
    count_ = std::min(count_ + 1, int(kLayers));
    glTexSubImage3D(GL_TEXTURE_2D_ARRAY, 0, 0, 0, head_, sw, sh, 1, GL_BGRA, GL_UNSIGNED_BYTE, small.data());
    glActiveTexture(GL_TEXTURE0);
}
