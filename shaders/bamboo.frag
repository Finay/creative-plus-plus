#version 410 core

// A shishi-odoshi (bamboo water dipper), dithered with ASCII characters.
// A spout trickles into a pivoting bamboo tube. When the tube fills it tips,
// pours into the stone basin, swings back and clacks on the rock.

uniform vec2  uResolution; // framebuffer size in pixels
uniform float uTime;       // seconds since start
uniform vec2  uMouse;      // cursor in pixels, origin bottom-left

out vec4 fragColor;

const float ROWS  = 84.0; // character rows on screen
const float CYCLE = 5.0;  // seconds per fill-tip-pour-clack cycle
const vec3  PAPER = vec3(0.02, 0.02, 0.03);

const vec3 BAMBOO = vec3(0.62, 0.85, 0.32);
const vec3 WATER  = vec3(0.55, 0.8, 1.0);
const vec3 STONE  = vec3(0.8, 0.8, 0.85);
const vec3 MOON   = vec3(1.0, 0.95, 0.75);

const float GROUND = -0.72;
const vec2  PIVOT  = vec2(0.05, -0.05);
const float TUBE_R = 0.06;   // tube half-thickness
const float MOUTH  = 0.62;   // pivot to open end
const float TAIL   = 0.5;    // pivot to closed end
const float SPOUT_Y = 0.52;
const float STREAM_X = -0.45;
const float BASIN_TOP = -0.57;

// 5x5 glyphs packed one bit per pixel, darkest to brightest: (blank) . : * o & 8 @ #
const int GLYPHS[9] = int[9](0, 4096, 65600, 332772, 15255086,
                             23385164, 15252014, 13199452, 11512810);

const float BAYER[16] = float[16]( 0.0,  8.0,  2.0, 10.0,
                                  12.0,  4.0, 14.0,  6.0,
                                   3.0, 11.0,  1.0,  9.0,
                                  15.0,  7.0, 13.0,  5.0);

float glyph(int n, vec2 p) {
    p = floor(p * vec2(-4.0, 4.0) + 2.5);
    if (clamp(p.x, 0.0, 4.0) != p.x || clamp(p.y, 0.0, 4.0) != p.y) return 0.0;
    int bit = int(p.x + 5.0 * p.y);
    return float((n >> bit) & 1);
}

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// How far the tube has tipped at cycle phase ph: 0 resting on the rock, 1 pouring.
float tilt(float ph) {
    float down = smoothstep(0.58, 0.70, ph);
    float back = smoothstep(0.86, 0.93, ph);
    float a = down * down * (1.0 - back * back);
    // A small damped bounce after the tail hits the rock.
    float x = clamp((ph - 0.93) / 0.07, 0.0, 1.0);
    a += 0.1 * abs(sin(x * 9.42)) * (1.0 - x) * (1.0 - x) * step(0.93, ph);
    return a;
}

// Brightness across a bamboo cane: s in [-1, 1] across it, `along` in scene units.
float cane(float s, float along) {
    float body = sqrt(max(1.0 - s * s, 0.0));
    float lum = 0.28 + 0.62 * body * (0.65 + 0.35 * s);
    float node = abs(fract(along / 0.28) - 0.5);
    if (node < 0.05) lum *= 0.5;
    return lum;
}

// Colour (rgb) and brightness (a) of the scene at p; y spans [-1, 1].
vec4 scene(vec2 p) {
    float ph = fract(uTime / CYCLE);
    float a = tilt(ph);
    float phi = mix(-0.44, 0.35, a);
    vec2 u = vec2(cos(phi), sin(phi)); // tube axis, mouth towards tail
    vec2 n = vec2(-u.y, u.x);
    float pour = smoothstep(0.68, 0.72, ph) * (1.0 - smoothstep(0.82, 0.88, ph));

    // Night sky, brighter towards the horizon.
    vec3 col = vec3(0.55, 0.65, 1.0);
    float lum = mix(0.11, 0.02, smoothstep(GROUND, 0.9, p.y));

    // Moon with a soft halo.
    float md = length(p - vec2(0.85, 0.6));
    lum += 0.22 * exp(-max(md - 0.17, 0.0) * 9.0);
    if (md < 0.17) {
        col = MOON;
        lum = 0.95 - 0.3 * smoothstep(0.05, 0.0, length(p - vec2(0.8, 0.64)) - 0.03)
                   - 0.25 * smoothstep(0.04, 0.0, length(p - vec2(0.9, 0.55)) - 0.02);
    }

    // Distant bamboo, swaying, dark against the moon.
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float x0 = 0.9 + 0.16 * fi;
        float x = x0 + 0.025 * sin(uTime * 0.6 + fi * 1.7) * (p.y - GROUND);
        float w = 0.024 - 0.004 * fi;
        if (abs(p.x - x) < w && p.y > GROUND) {
            col = BAMBOO * 0.8;
            lum = 0.42 * cane((p.x - x) / w, p.y + fi * 0.1);
        }
    }

    // Ground.
    if (p.y < GROUND) {
        col = vec3(0.55, 0.65, 0.45);
        lum = 0.1 + 0.14 * hash(floor(p * 60.0)) * smoothstep(-1.0, GROUND, p.y);
    }

    // Rock the tail rests on.
    vec2 rk = (p - vec2(0.52, -0.5)) / vec2(0.2, 0.19);
    if (dot(rk, rk) < 1.0 && p.y > GROUND) {
        col = STONE;
        float facing = clamp(dot(normalize(rk + 1e-4), vec2(-0.5, 0.85)), 0.0, 1.0);
        lum = 0.34 + 0.45 * facing * length(rk) + 0.08 * hash(floor(p * 45.0));
    }

    // Stone basin with a strip of water on top.
    vec2 bq = abs(p - vec2(-0.55, -0.665)) - vec2(0.27, 0.07);
    float basin = length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0) - 0.04;
    if (basin < 0.0) {
        col = STONE;
        lum = 0.26 + 0.3 * smoothstep(-0.78, BASIN_TOP, p.y) + 0.1 * hash(floor(p * 45.0));
        if (p.y > BASIN_TOP - 0.035 && abs(p.x + 0.55) < 0.25) {
            col = WATER;
            float ripple = sin((p.x + 0.55) * 46.0 - uTime * 5.0) * sin((p.x + 0.55) * 17.0 + uTime * 2.0);
            lum = 0.55 + (0.15 + 0.3 * pour) * ripple;
        }
    }

    // Post holding the spout, then the spout itself.
    if (abs(p.x + 1.05) < 0.035 && p.y > GROUND && p.y < SPOUT_Y) {
        col = BAMBOO;
        lum = cane((p.x + 1.05) / 0.035, p.y);
    }
    if (abs(p.y - SPOUT_Y) < 0.035 && p.x < STREAM_X + 0.02) {
        col = BAMBOO;
        lum = cane((p.y - SPOUT_Y) / 0.035, p.x + 0.1);
    }

    // Pivot post behind the tube.
    if (abs(p.x - PIVOT.x) < 0.04 && p.y > GROUND && p.y < PIVOT.y + 0.13) {
        col = BAMBOO;
        lum = cane((p.x - PIVOT.x) / 0.04, p.y) * 0.8;
    }

    // Trickle from the spout, ending where it meets the top of the tube.
    float s = (STREAM_X - PIVOT.x) / u.x;
    float streamEnd = (s > -MOUTH && s < TAIL) ? PIVOT.y + s * u.y + TUBE_R / u.x : BASIN_TOP;
    if (abs(p.x - STREAM_X) < 0.014 && p.y < SPOUT_Y - 0.03 && p.y > streamEnd) {
        col = WATER;
        lum = 0.75 + 0.25 * sin(p.y * 70.0 + uTime * 26.0);
    }
    // Splash where the trickle lands.
    float sd = length(p - vec2(STREAM_X, streamEnd + 0.01));
    if (sd < 0.045 && hash(floor(p * 70.0) + floor(uTime * 12.0)) > 0.45) {
        col = WATER;
        lum = 0.85;
    }

    // The tube: a cane cut diagonally at the open end so the mouth faces up.
    vec2 q = vec2(dot(p - PIVOT, u), dot(p - PIVOT, n));
    float cut = -MOUTH + max(q.y + TUBE_R, 0.0) * 0.9;
    if (abs(q.y) < TUBE_R && q.x > cut && q.x < TAIL) {
        col = BAMBOO;
        lum = cane(q.y / TUBE_R, q.x + 0.09);
        if (q.x - cut < 0.035) lum = 0.22;       // dark rim of the mouth
        if (q.x > TAIL - 0.03) lum *= 0.75;      // closed end
        if (length(q) < 0.022) lum = 1.0;        // pivot pin
    }

    // Water pouring out of the mouth while tipped.
    vec2 tip = PIVOT + u * (-MOUTH) + n * (-TUBE_R * 0.4);
    float px = tip.x - 0.02 - 0.25 * (tip.y - p.y) * (tip.y - p.y);
    if (pour > 0.0 && abs(p.x - px) < 0.03 * pour && p.y < tip.y && p.y > BASIN_TOP) {
        col = WATER;
        lum = 0.8 + 0.2 * sin(p.y * 60.0 + uTime * 30.0);
    }
    float pd = length((p - vec2(tip.x - 0.04, BASIN_TOP + 0.02)) / vec2(1.6, 1.0));
    if (pour > 0.0 && pd < 0.07 * pour && hash(floor(p * 70.0) + floor(uTime * 14.0)) > 0.4) {
        col = WATER;
        lum = 0.9;
    }

    // Clack: short strokes flash around the rock as the tail lands.
    float hit = step(0.93, ph) * (1.0 - smoothstep(0.93, 0.99, ph));
    if (hit > 0.0) {
        vec2 c = p - vec2(0.56, -0.27);
        float r = length(c), ang = atan(c.y, c.x);
        float spoke = abs(fract(ang / 0.7 + 0.25) - 0.5);
        float reach = 0.08 + 0.1 * (1.0 - hit);
        if (c.y > 0.0 && spoke < 0.09 && r > reach && r < reach + 0.07) {
            col = vec3(1.0);
            lum = hit;
        }
    }

    return vec4(col, clamp(lum, 0.0, 1.0));
}

void main() {
    float cellSize = max(8.0, floor(uResolution.y / ROWS));
    vec2 cell = floor(gl_FragCoord.xy / cellSize);

    // Average four samples per cell so edges land on in-between glyphs.
    vec3 col = vec3(0.0);
    float lum = 0.0;
    for (int i = 0; i < 4; i++) {
        vec2 o = vec2(i & 1, i >> 1) * 0.5 + 0.25;
        vec2 uv = (2.0 * (cell + o) * cellSize - uResolution) / uResolution.y;
        vec4 smp = scene(uv);
        col += smp.rgb * (smp.a + 0.02);
        lum += smp.a;
    }
    col /= lum + 0.08;
    lum *= 0.25;

    // Ordered dither: the threshold nudges each cell up or down one glyph.
    ivec2 b = ivec2(mod(cell, 4.0));
    float threshold = (BAYER[b.y * 4 + b.x] + 0.5) / 16.0;
    int level = clamp(int(floor(lum * 8.0 + threshold)), 0, 8);

    vec2 local = fract(gl_FragCoord.xy / cellSize) * 2.0 - 1.0;
    fragColor = vec4(mix(PAPER, col, glyph(GLYPHS[level], local)), 1.0);
}
