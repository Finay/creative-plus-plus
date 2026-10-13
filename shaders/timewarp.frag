#version 410 core

// Live camera, dithered with ASCII characters, with time sliding down the
// screen: the top row of characters is live, and every row below it shows
// the camera from a little further in the past.

uniform vec2           uResolution;    // framebuffer size in pixels
uniform float          uTime;          // seconds since start
uniform vec2           uMouse;         // cursor in pixels, origin bottom-left
uniform vec2           uCameraSize;    // camera frame size in pixels
uniform sampler2DArray uHistory;       // recent camera frames, one per layer, top row first
uniform int            uHistoryHead;   // layer holding the newest frame
uniform int            uHistoryCount;  // layers holding a real frame so far
uniform int            uHistoryLayers; // total layers in the ring

out vec4 fragColor;

const float ROWS      = 72.0;  // character rows on screen
const float MAX_DELAY = 75.0;  // delay at the bottom row, in camera frames (30 per second)
const float CONTRAST  = 1.3;   // >1 pushes shadows and highlights apart
const bool  TINT      = true;  // colour glyphs from the camera, else monochrome
const vec3  PAPER     = vec3(0.02, 0.02, 0.03);
const vec3  INK       = vec3(0.85, 1.0, 0.8);

// 5x5 glyphs packed one bit per pixel, darkest to brightest: (blank) . : * o & 8 @ #
const int GLYPHS[9] = int[9](0, 4096, 65600, 332772, 15255086,
                             23385164, 15252014, 13199452, 11512810);

const float BAYER[16] = float[16]( 0.0,  8.0,  2.0, 10.0,
                                  12.0,  4.0, 14.0,  6.0,
                                   3.0, 11.0,  1.0,  9.0,
                                  15.0,  7.0, 13.0,  5.0);

// 1 where glyph n has a lit pixel at p, with p in [-1, 1] across the cell.
float glyph(int n, vec2 p) {
    p = floor(p * vec2(-4.0, 4.0) + 2.5);
    if (clamp(p.x, 0.0, 4.0) != p.x || clamp(p.y, 0.0, 4.0) != p.y) return 0.0;
    int bit = int(p.x + 5.0 * p.y);
    return float((n >> bit) & 1);
}

// Camera texture coordinate behind the screen position st in [0, 1].
vec2 cameraCoord(vec2 st) {
    // Scale to cover the window, cropping whichever axis overflows.
    float screenAspect = uResolution.x / uResolution.y;
    float cameraAspect = uCameraSize.x / uCameraSize.y;
    vec2 c = st - 0.5;
    if (screenAspect > cameraAspect) c.y *= cameraAspect / screenAspect;
    else c.x *= screenAspect / cameraAspect;
    // Mirror like a selfie view, and flip because camera rows run top-down.
    return vec2(0.5 - c.x, 0.5 - c.y);
}

// Camera colour at tc as it was `delay` frames ago, blending between frames.
vec3 pastAt(vec2 tc, float delay) {
    float oldest = float(max(uHistoryCount - 1, 0));
    delay = clamp(delay, 0.0, oldest);
    float a = floor(delay);
    float b = min(a + 1.0, oldest);
    float n = float(uHistoryLayers);
    vec3 newer = texture(uHistory, vec3(tc, mod(float(uHistoryHead) - a + n, n))).rgb;
    vec3 older = texture(uHistory, vec3(tc, mod(float(uHistoryHead) - b + n, n))).rgb;
    return mix(newer, older, delay - a);
}

void main() {
    float cellSize = max(8.0, floor(uResolution.y / ROWS));
    vec2 cell = floor(gl_FragCoord.xy / cellSize);
    vec2 center = (cell + 0.5) * cellSize;

    // 0 at the top of the screen, 1 at the bottom; constant along a character row.
    float fromTop = clamp(1.0 - center.y / uResolution.y, 0.0, 1.0);

    vec3 col = pastAt(cameraCoord(center / uResolution), fromTop * MAX_DELAY);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    lum = clamp((lum - 0.5) * CONTRAST + 0.5, 0.0, 1.0);

    // Ordered dither: the threshold nudges each cell up or down one glyph.
    ivec2 b = ivec2(mod(cell, 4.0));
    float threshold = (BAYER[b.y * 4 + b.x] + 0.5) / 16.0;
    int level = clamp(int(floor(lum * 8.0 + threshold)), 0, 8);

    // The glyph already carries brightness, so tint with the hue at full value.
    vec3 ink = INK;
    if (TINT) ink = mix(vec3(1.0), col / max(max(col.r, max(col.g, col.b)), 0.05), 0.85);

    vec2 local = fract(gl_FragCoord.xy / cellSize) * 2.0 - 1.0;
    fragColor = vec4(mix(PAPER, ink, glyph(GLYPHS[level], local)), 1.0);
}
