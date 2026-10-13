#version 410 core

// Live camera, dithered with ASCII characters, plus a red ball to bat around.
// The camera is averaged down to one sample per character cell; that
// brightness is ordered-dithered across a ramp of 5x5 bitmap glyphs.
// Cells bright enough to be solid to the ball are drawn in white; the rest
// are dimmed. The ball is dithered in red and simulated in src/ball.cpp:
// squeeze it between bright areas (or against an edge) and it flattens, then
// pops into shards, and a new one drops in. Space drops a new one at any time.

uniform vec2      uResolution; // framebuffer size in pixels
uniform float     uTime;       // seconds since start
uniform vec2      uMouse;      // cursor in pixels, origin bottom-left
uniform sampler2D uCamera;     // live camera frame, top row first
uniform vec2      uCameraSize; // camera frame size in pixels
uniform vec3      uBall;       // ball centre in pixels (xy) and radius (z); radius 0 = no ball
uniform vec3      uBallSquish; // unit axis the ball is flattened along (xy), amount 0..1 (z)
uniform vec3      uShards[32]; // pieces of a popped ball: position (xy), life 1..0 (z)
uniform int       uShardCount;
uniform float     uShardSize;  // shard radius in pixels
uniform float     uSolid;      // camera brightness that is solid to the ball

out vec4 fragColor;

const int   MAX_SHARDS = 32;
const float ROWS     = 72.0;  // character rows on screen
const float CONTRAST = 1.3;   // >1 pushes shadows and highlights apart
const bool  TINT     = true;  // colour glyphs from the camera, else monochrome
const vec3  PAPER    = vec3(0.02, 0.02, 0.03);
const vec3  INK      = vec3(0.85, 1.0, 0.8);

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

// Camera colour behind the screen position st in [0, 1], averaged over one cell.
vec3 cameraAt(vec2 st, float cellSize) {
    // Scale to cover the window, cropping whichever axis overflows.
    float screenAspect = uResolution.x / uResolution.y;
    float cameraAspect = uCameraSize.x / uCameraSize.y;
    vec2 c = st - 0.5;
    float texelsPerPixel;
    if (screenAspect > cameraAspect) {
        c.y *= cameraAspect / screenAspect;
        texelsPerPixel = uCameraSize.x / uResolution.x;
    } else {
        c.x *= screenAspect / cameraAspect;
        texelsPerPixel = uCameraSize.y / uResolution.y;
    }
    // Mirror like a selfie view, and flip because camera rows run top-down.
    vec2 tc = vec2(0.5 - c.x, 0.5 - c.y);
    return textureLod(uCamera, tc, log2(max(cellSize * texelsPerPixel, 1.0))).rgb;
}

void main() {
    float cellSize = max(8.0, floor(uResolution.y / ROWS));
    vec2 cell = floor(gl_FragCoord.xy / cellSize);
    vec2 center = (cell + 0.5) * cellSize;

    vec3 col = cameraAt(center / uResolution, cellSize);
    float raw = dot(col, vec3(0.299, 0.587, 0.114));
    float lum = clamp((raw - 0.5) * CONTRAST + 0.5, 0.0, 1.0);

    // Ordered dither: the threshold nudges each cell up or down one glyph.
    ivec2 b = ivec2(mod(cell, 4.0));
    float threshold = (BAYER[b.y * 4 + b.x] + 0.5) / 16.0;
    int level = clamp(int(floor(lum * 8.0 + threshold)), 0, 8);

    // The glyph already carries brightness, so tint with the hue at full value.
    vec3 ink = INK;
    if (TINT) ink = mix(vec3(1.0), col / max(max(col.r, max(col.g, col.b)), 0.05), 0.85);

    ink = raw >= uSolid ? vec3(1.0) : ink * 0.7;

    const vec3 RED = vec3(1.0, 0.08, 0.06);

    // Shards of a popped ball: red cells that fade down the glyph ramp.
    float shard = 0.0;
    float shardSize = max(uShardSize, 0.75 * cellSize);
    for (int i = 0; i < MAX_SHARDS; i++) {
        if (i >= uShardCount) break;
        vec2 q = (center - uShards[i].xy) / shardSize;
        if (dot(q, q) < 1.0) shard = max(shard, uShards[i].z);
    }
    if (shard > 0.0) {
        level = clamp(int(floor(shard * 8.0 + threshold)), 1, 8);
        ink = RED;
    }

    // The ball: a red sphere shaded once per cell and dithered through the
    // same glyph ramp, so it is made of characters like everything else.
    // Squish flattens it along one axis and bulges it along the other.
    if (uBall.z > 0.0) {
        vec2 axis = dot(uBallSquish.xy, uBallSquish.xy) > 0.25 ? normalize(uBallSquish.xy) : vec2(1.0, 0.0);
        vec2 side = vec2(-axis.y, axis.x);
        float k = 0.55 * clamp(uBallSquish.z, 0.0, 1.0);
        vec2 rel = (center - uBall.xy) / uBall.z;
        vec2 e = vec2(dot(rel, axis) / (1.0 - k), dot(rel, side) / (1.0 + k));
        float r2 = dot(e, e);
        if (r2 < 1.0) {
            vec3 n = vec3(axis * e.x + side * e.y, sqrt(1.0 - r2));
            vec3 l = normalize(vec3(-0.45, 0.6, 0.65));
            float diff = max(dot(n, l), 0.0);
            float spec = pow(max(reflect(-l, n).z, 0.0), 16.0);
            float ballLum = clamp(0.3 + 0.6 * diff + 0.4 * spec, 0.0, 1.0);
            // Never below '*', so the ball stays readable over dark backgrounds.
            level = clamp(int(floor(ballLum * 8.0 + threshold)), 3, 8);
            // Paler as it nears bursting.
            ink = mix(RED, vec3(1.0, 0.75, 0.7), max(spec, 0.6 * uBallSquish.z));
        }
    }

    vec2 local = fract(gl_FragCoord.xy / cellSize) * 2.0 - 1.0;
    vec3 outCol = mix(PAPER, ink, glyph(GLYPHS[level], local));

    fragColor = vec4(outCol, 1.0);
}
