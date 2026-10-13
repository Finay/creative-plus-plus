#version 410 core

// Spinning donut, dithered with ASCII characters.
// The torus is raymarched once per character cell; its brightness is
// ordered-dithered across a ramp of 5x5 bitmap glyphs.

uniform vec2  uResolution; // framebuffer size in pixels
uniform float uTime;       // seconds since start
uniform vec2  uMouse;      // cursor in pixels, origin bottom-left

out vec4 fragColor;

const float ROWS = 56.0; // character rows on screen

// 5x5 glyphs packed one bit per pixel, darkest to brightest:  . : * o & 8 @ #
const int GLYPHS[8] = int[8](4096, 65600, 332772, 15255086,
                             23385164, 15252014, 13199452, 11512810);

const float BAYER[16] = float[16]( 0.0,  8.0,  2.0, 10.0,
                                  12.0,  4.0, 14.0,  6.0,
                                   3.0, 11.0,  1.0,  9.0,
                                  15.0,  7.0, 13.0,  5.0);

mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

float sdTorus(vec3 p) {
    p.yz *= rot(uTime * 1.0);
    p.xy *= rot(uTime * 0.5);
    return length(vec2(length(p.xz) - 1.0, p.y)) - 0.45;
}

vec3 normalAt(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(sdTorus(p + e.xyy) - sdTorus(p - e.xyy),
                          sdTorus(p + e.yxy) - sdTorus(p - e.yxy),
                          sdTorus(p + e.yyx) - sdTorus(p - e.yyx)));
}

// Brightness of the donut along the ray through uv, or -1 on a miss.
float shade(vec2 uv) {
    vec3 ro = vec3(0.0, 0.0, -4.0);
    vec3 rd = normalize(vec3(uv, 1.8));
    float t = 0.0;
    for (int i = 0; i < 64; i++) {
        float d = sdTorus(ro + rd * t);
        if (d < 0.001) {
            vec3 n = normalAt(ro + rd * t);
            vec3 l = normalize(vec3(-0.5, 0.7, -0.6));
            float diff = max(dot(n, l), 0.0);
            float spec = pow(max(dot(reflect(l, n), rd), 0.0), 24.0);
            return clamp(0.06 + 0.8 * diff + 0.35 * spec, 0.0, 1.0);
        }
        t += d;
        if (t > 8.0) break;
    }
    return -1.0;
}

// 1 where glyph n has a lit pixel at p, with p in [-1, 1] across the cell.
float glyph(int n, vec2 p) {
    p = floor(p * vec2(-4.0, 4.0) + 2.5);
    if (clamp(p.x, 0.0, 4.0) != p.x || clamp(p.y, 0.0, 4.0) != p.y) return 0.0;
    int bit = int(p.x + 5.0 * p.y);
    return float((n >> bit) & 1);
}

void main() {
    float cellSize = max(8.0, floor(uResolution.y / ROWS));
    vec2 cell = floor(gl_FragCoord.xy / cellSize);
    vec2 center = (cell + 0.5) * cellSize;
    vec2 uv = (2.0 * center - uResolution) / uResolution.y;

    float lum = shade(uv);
    if (lum < 0.0) {
        fragColor = vec4(0.02, 0.02, 0.03, 1.0);
        return;
    }

    // Ordered dither: the threshold nudges each cell up or down one glyph.
    ivec2 b = ivec2(mod(cell, 4.0));
    float threshold = (BAYER[b.y * 4 + b.x] + 0.5) / 16.0;
    int level = clamp(int(floor(lum * 7.0 + threshold)), 0, 7);

    vec2 local = fract(gl_FragCoord.xy / cellSize) * 2.0 - 1.0;
    vec3 ink = mix(vec3(1.0, 0.55, 0.2), vec3(1.0, 0.97, 0.9), lum);
    fragColor = vec4(mix(vec3(0.02, 0.02, 0.03), ink, glyph(GLYPHS[level], local)), 1.0);
}
