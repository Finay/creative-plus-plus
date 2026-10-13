#version 410 core

// Mandelbrot zoom that never runs out of precision.
//
// The view closes in on a Misiurewicz point: a value of c whose critical orbit
// lands on a repelling fixed point after a few steps. Around such a point the
// set repeats itself, scaled and turned by the fixed point's multiplier, so the
// picture at any depth is the picture one multiplier further out.
//
// Each pixel is iterated as a small offset dz from that known orbit instead of
// as a full coordinate, so 32-bit floats only ever hold the offset. Once the
// view is deep enough that the offset stays small for the first k laps around
// the fixed point, those laps are not iterated: their effect is a
// multiplication by multiplier^k plus a second-order correction. That keeps
// every number near the same size however deep the zoom is.

uniform vec2  uResolution; // framebuffer size in pixels
uniform float uTime;       // seconds since start

out vec4 fragColor;

const float DOUBLING = 3.0;  // seconds for the magnification to double
const float VIEW     = 1.3;  // half-height of the opening view
const int   MAX_ITER = 300;  // steps before a point is taken as never escaping
const int   AA       = 2;    // samples per pixel along each axis, used only near the set
const float AA_RANGE = 1.5;  // pixels from the set within which a pixel is supersampled
const float GLOW     = 0.9;  // falloff of the white edge, per pixel of distance from the set

const float BAILOUT  = 64.0;
const float SKIP_MAX = 8e-3; // largest offset, at the top of the view, that skipped laps may leave
const float TAU      = 6.2831853;

// Critical orbit of c = 0.4379242413594628 + 0.3418920843381161i, the centre of
// a five-armed hub. ORBIT[0] is c itself; the last entry is the fixed point,
// where the orbit stays from then on.
const int  PRE = 6;
const vec2 ORBIT[PRE] = vec2[PRE](vec2( 0.437924241,  0.341892084),
                                  vec2( 0.512811685,  0.641337748),
                                  vec2( 0.289585959,  0.999663067),
                                  vec2(-0.477541978,  0.920868861),
                                  vec2(-0.182028876, -0.537614989),
                                  vec2( 0.182028876,  0.537614989));

// Set once per pixel in main, read by shade.
vec2  gStep;     // offset in c per pixel
vec2  gStepSkip; // the same after the skipped laps: gStep * multiplier^k
bool  gSkip;     // true once laps are being skipped
float gDepth;    // zoom depth in laps, less the skipped ones

// Offset from the orbit after PRE steps and k laps, to second order, for a
// point dc from the centre with w = dc * multiplier^k:
//   gLinW * w + gLinC * dc + gQuadWW * w^2 + gQuadWC * w * dc + gQuadCC * dc^2
vec2 gLinW, gLinC, gQuadWW, gQuadWC, gQuadCC;

vec2 cmul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cdiv(vec2 a, vec2 b) {
    return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b);
}

vec2 polar(float r, float a) {
    return r * vec2(cos(a), sin(a));
}

vec3 palette(float t) {
    return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.10, 0.22)));
}

// Colour of the point p pixels from the centre of the screen, with its distance
// from the set in pixels in w.
vec4 shade(vec2 p) {
    vec2 dc = cmul(p, gStep);

    // Inside the main cardioid or the period-2 disc: never escapes. Only
    // reachable in the opening seconds, while c still fits in a float.
    if (!gSkip) {
        vec2  c = ORBIT[0] + dc;
        float q = dot(c - vec2(0.25, 0.0), c - vec2(0.25, 0.0));
        if (q * (q + c.x - 0.25) < 0.25 * c.y * c.y) return vec4(0.0, 0.0, 0.0, 1e9);
        if (dot(c + vec2(1.0, 0.0), c + vec2(1.0, 0.0)) < 0.0625) return vec4(0.0, 0.0, 0.0, 1e9);
    }

    vec2 dz  = vec2(0.0); // offset from the reference orbit
    vec2 der = vec2(0.0); // change in z per pixel, for the distance estimate
    int  n   = 0;
    if (gSkip) {
        vec2 w = cmul(p, gStepSkip);
        dz  = cmul(gLinW, w) + cmul(gLinC, dc)
            + cmul(gQuadWW, cmul(w, w)) + cmul(gQuadWC, cmul(w, dc)) + cmul(gQuadCC, cmul(dc, dc));
        der = cmul(gLinW, gStepSkip) + cmul(gLinC, gStep)
            + 2.0 * cmul(gQuadWW, cmul(w, gStepSkip))
            + cmul(gQuadWC, cmul(gStepSkip, dc) + cmul(w, gStep))
            + 2.0 * cmul(gQuadCC, cmul(dc, gStep));
        n   = PRE;
    }

    vec2  z  = vec2(0.0);
    float r2 = 0.0;
    int   i  = 0;
    for (; i < MAX_ITER; i++) {
        vec2 ref = n == 0 ? vec2(0.0) : ORBIT[min(n, PRE) - 1];
        z  = ref + dz;
        r2 = dot(z, z);
        if (r2 > BAILOUT * BAILOUT) break;
        der = cmul(2.0 * z, der) + gStep;
        dz  = cmul(2.0 * ref + dz, dz) + dc;
        n++;
    }

    // Never escaped. Deep inside the set der settles to something small and
    // the point is black; on a filament it blows up and the point is white.
    if (i == MAX_ITER) {
        float d = 1.0 / length(der);
        if (!(d > 0.0)) d = 0.0;
        return vec4(vec3(exp(-GLOW * d)), d);
    }

    // Smooth escape count, measured against the zoom depth so that a feature
    // keeps its colour as it grows.
    float r  = sqrt(r2);
    float nu = float(n) - log2(log(r) / log(BAILOUT)) - gDepth;

    // Distance to the set in pixels. Overflow in der means the point is on it.
    float d = r * log(r) / length(der);
    if (!(d > 0.0)) d = 0.0;

    float glow = exp(-GLOW * d);
    float body = 0.35 + 0.65 * min(1.0, pow(d / 40.0, 0.35));
    return vec4(mix(palette(0.045 * nu + 0.55) * body, vec3(1.0), glow), d);
}

void main() {
    vec2  one     = vec2(1.0, 0.0);
    vec2  mult    = 2.0 * ORBIT[PRE - 1]; // multiplier: one lap scales and turns an offset by this
    float multLog = log(length(mult));
    float multArg = atan(mult.y, mult.x);

    // First- and second-order growth of an offset in c over the first PRE
    // steps: dz = lin * dc + quad * dc^2.
    vec2 lin = vec2(0.0), quad = vec2(0.0), ref = vec2(0.0);
    for (int n = 0; n < PRE; n++) {
        quad = cmul(2.0 * ref, quad) + cmul(lin, lin);
        lin  = cmul(2.0 * ref, lin) + one;
        ref  = ORBIT[n];
    }

    // Each lap after that maps lin to mult * lin + 1 and quad to
    // mult * quad + lin^2. Solving those recurrences for lap k gives the
    // coefficients, apart from the k in gQuadWC, added below.
    gLinC   = cdiv(-one, mult - one);
    gLinW   = lin - gLinC;
    gQuadWW = cdiv(cmul(gLinW, gLinW), cmul(mult, mult - one));
    gQuadCC = cdiv(cmul(gLinC, gLinC), one - mult);
    gQuadWC = quad - gQuadWW - gQuadCC;
    vec2 perLap = cdiv(2.0 * cmul(gLinC, gLinW), mult);

    // Depth in laps: each one magnifies by |mult|.
    float depth     = uTime * log(2.0) / (DOUBLING * multLog);
    float skipAfter = log(VIEW * length(gLinW) / SKIP_MAX) / multLog;
    int   k         = max(0, int(floor(depth - skipAfter)));
    gSkip    = k > 0;
    gDepth   = depth - float(k);
    gQuadWC += float(k) * perLap;

    // Angle of mult^k. The turn count wraps in a uint so that the angle stays
    // exact however large k gets.
    uint  turn  = uint(fract(multArg / TAU) * 4294967296.0);
    float angle = float(uint(k) * turn) * (TAU / 4294967296.0);

    float pixel = 2.0 / uResolution.y;
    gStepSkip = polar(pixel * VIEW * exp(-gDepth * multLog), angle);
    gStep     = cmul(gStepSkip, polar(exp(-float(k) * multLog), -angle));

    // One sample is enough where the colour is smooth; near the set, fill in
    // the rest of the grid and average.
    vec2 p = gl_FragCoord.xy - 0.5 * uResolution - 0.5 + 0.5 / float(AA);
    vec4 first = shade(p);
    vec3 col = first.rgb;
    if (AA > 1 && first.w < AA_RANGE) {
        for (int a = 0; a < AA; a++) {
            for (int b = 0; b < AA; b++) {
                if (a + b > 0) col += shade(p + vec2(a, b) / float(AA)).rgb;
            }
        }
        col /= float(AA * AA);
    }
    fragColor = vec4(col, 1.0);
}
