#version 410 core

// Mandelbrot zoom that runs forever without leaving 32-bit floats.
//
// The view closes in on a minibrot: a copy of the whole set, about 1e-12 of
// its size, buried in the filaments above the main body. The copy's centre has
// a critical orbit that returns to zero after PERIOD steps. That orbit is
// worked out ahead of time at high precision and stored below; each pixel is
// then iterated as a small offset dz from it, so floats only ever hold the
// offset. The first steps, while the offset is still tiny across the whole
// screen, are replaced by a cubic in the pixel's position, also worked out
// ahead of time.
//
// Because the minibrot is a copy of the set, the view of it from far out
// matches the view of the whole set from far out. The zoom wraps there,
// fading from one to the other while both are a dot on screen, and carries on
// into the set again.

uniform vec2  uResolution; // framebuffer size in pixels
uniform float uTime;       // seconds since start
uniform float uFps;        // frames per second, averaged over the last half second

out vec4 fragColor;

const float DOUBLING   = 3.0;    // seconds for the magnification to double
const float VIEW       = 2.4;    // half-height of the view when the whole set fills it
const float WRAP       = 0.8;    // fraction of the way to the minibrot at which the zoom wraps
const float FADE       = 4.0;    // seconds the wrap takes to fade
const float ITER_START = 100.0;  // most steps per pixel at the start of the zoom
const float ITER_END   = 4000.0; // and at the minibrot
const float GLOW       = 0.45;   // falloff of the white edge with distance from the set
const vec3  FPS_COLOUR = vec3(0.1, 1.0, 0.2);

const float BAILOUT = 64.0;
const float TAU     = 6.2831853;

// The minibrot. NUCLEUS is its centre, to float precision; in full it is
//   -0.1523692670826769497675108778263821379031
//   1.0341979672958539956193438184272756134588 i
// SIZE is the factor, a scale and a turn, that maps the whole set onto it.
// ORBIT is the critical orbit of the centre: ORBIT[n] is z after n steps.
const int  PERIOD  = 92;
const vec2 NUCLEUS = vec2(-0.152369267, 1.03419797);
const vec2 SIZE    = vec2(-1.16285166e-12, -6.92464674e-13);
const vec2 ORBIT[PERIOD] = vec2[PERIOD](
    vec2( 0.000000000,  0.000000000), vec2(-0.152369267,  1.034197967), vec2(-1.198718309,  0.719037995),
    vec2( 0.767540680, -0.689650051), vec2(-0.038867765, -0.024470971), vec2(-0.151457392,  1.036100231),
    vec2(-1.202933614,  0.720347889), vec2( 0.775778933, -0.698863412), vec2(-0.038946384, -0.050129056),
    vec2(-0.153365369,  1.038102658), vec2(-1.206505460,  0.715779974), vec2( 0.790945187, -0.692986925),
    vec2(-0.007005857, -0.062031379), vec2(-0.156168077,  1.035067133), vec2(-1.199344769,  0.710909080),
    vec2( 0.780666889, -0.671052205), vec2( 0.006760462, -0.013538507), vec2(-0.152506854,  1.034014914),
    vec2(-1.198297769,  0.718809243), vec2( 0.766861548, -0.688497058), vec2(-0.038320832, -0.021765873),
    vec2(-0.151374534,  1.035866140), vec2(-1.202473678,  0.720590459), vec2( 0.774323069, -0.698784150),
    vec2(-0.041092340, -0.047971408), vec2(-0.152981943,  1.038140482), vec2(-1.206701453,  0.716564472),
    vec2( 0.790294487, -0.695160811), vec2(-0.011052444, -0.064565547), vec2(-0.156415820,  1.035625182),
    vec2(-1.200422875,  0.710221643), vec2( 0.784231030, -0.670934645), vec2( 0.012495744, -0.018137567),
    vec2(-0.152542095,  1.033744683), vec2(-1.197728245,  0.718818809), vec2( 0.765483202, -0.687701213),
    vec2(-0.039337692, -0.018649486), vec2(-0.151169616,  1.035665223), vec2(-1.202119468,  0.721075738),
    vec2( 0.772771727, -0.699440399), vec2(-0.044409996, -0.046817563), vec2(-0.152588904,  1.038356303),
    vec2(-1.207269705,  0.717314668), vec2( 0.790590541, -0.697786568), vec2(-0.014241958, -0.069128954),
    vec2(-0.156945246,  1.036167031), vec2(-1.201379572,  0.708954988), vec2( 0.788326434, -0.669250114),
    vec2( 0.021193584, -0.020977143), vec2(-0.152360140,  1.033308806), vec2(-1.196882743,  0.719327819),
    vec2( 0.762726521, -0.687704140), vec2(-0.043554505, -0.014862404), vec2(-0.150693163,  1.035492617),
    vec2(-1.201905797,  0.722114652), vec2( 0.770758707, -0.701629604), vec2(-0.050584384, -0.047376285),
    vec2(-0.152055000,  1.038990968), vec2(-1.208750775,  0.718230425), vec2( 0.792854226, -0.702125198),
    vec2(-0.016731237, -0.079167894), vec2(-0.158356888,  1.036847121), vec2(-1.202344315,  0.705814200),
    vec2( 0.795088900, -0.663065415), vec2( 0.040141348, -0.020193936), vec2(-0.151165734,  1.032576744),
    vec2(-1.195732919,  0.722017524), vec2( 0.756098643, -0.692482276), vec2(-0.060215813, -0.012971851),
    vec2(-0.148911592,  1.035760188), vec2(-1.202993773,  0.725724570), vec2( 0.768148598, -0.711886310),
    vec2(-0.069099117, -0.059470976), vec2(-0.151131376,  1.042416751), vec2(-1.216161257,  0.719114211),
    vec2( 0.809553688, -0.714919719), vec2(-0.008102298, -0.123333823), vec2(-0.167514852,  1.036196542),
    vec2(-1.198011316,  0.687041347), vec2( 0.810836032, -0.611968649), vec2( 0.130580177,  0.041785505),
    vec2(-0.137064113,  1.045110685), vec2(-1.225839039,  0.747703630), vec2( 0.791251365, -0.798930631),
    vec2(-0.164580698, -0.230111936), vec2(-0.178233964,  1.109941933), vec2(-1.352573016,  0.638539266),
    vec2( 1.269352103, -0.693143994), vec2( 0.978436897, -0.725489605), vec2( 0.278634328, -0.385493630),
    vec2(-0.223337517,  0.819374450), vec2(-0.773864111,  0.668203857));

// Shortcuts past the first SKIP_N steps. For a point dc from the centre, the
// offset after that many steps is dc * (A + dc * (B + dc * C)), to within
// 0.03% wherever |dc| is at most SKIP_RADIUS.
const int   SKIPS = 18;
const int   SKIP_N[SKIPS] = int[SKIPS](7, 8, 12, 16, 32, 44, 56, 68, 80, 84, 87, 89, 90, 92, 94, 96, 132, 150);
const float SKIP_RADIUS[SKIPS] = float[SKIPS](0.003125, 0.001563, 0.0003906, 0.0001953, 4.883e-05, 2.441e-05, 1.221e-05, 6.104e-06, 3.052e-06, 1.526e-06, 7.629e-07, 3.815e-07, 1.907e-07, 9.537e-08, 3.725e-10, 1.863e-10, 4.657e-11, 2.328e-11);
const vec2  SKIP_A[SKIPS] = vec2[SKIPS](
    vec2(-2.19751537, -9.23225458),
    vec2(-15.3137421, -11.252851),
    vec2(2.27759327, -28.3910153),
    vec2(28.6528691, 16.9175745),
    vec2(54.0466797, 37.1698725),
    vec2(33.6012212, -77.5620091),
    vec2(-61.6717825, -109.471475),
    vec2(-274.725902, -351.550922),
    vec2(-234.235708, 4596.14446),
    vec2(11367.2574, -12872.616),
    vec2(11654.5847, 64300.2306),
    vec2(445748.983, 115551.523),
    vec2(337491.689, -279273.545),
    vec2(-1380842.69, -638905.217),
    vec2(0.695261466, 2.06839593),
    vec2(-10.0504394, -1.05487897),
    vec2(-37.2706865, -40.3032223),
    vec2(-33.2037455, -11.656375));
const vec2  SKIP_B[SKIPS] = vec2[SKIPS](
    vec2(-153.722531, -602.421264),
    vec2(-1160.93521, -679.253303),
    vec2(1377.76687, -6677.02056),
    vec2(16206.6453, 11468.4221),
    vec2(28095.293, 76349.1317),
    vec2(171206.515, -40933.8747),
    vec2(282176.901, -526662.19),
    vec2(2190754.17, -4449391.32),
    vec2(-103149383, 47061830.4),
    vec2(750269025, 222364592),
    vec2(-4.94323601e+09, 2.32780183e+09),
    vec2(-1.29122679e+10, 8.21612973e+10),
    vec2(2.41489712e+11, 1.58755058e+11),
    vec2(-3.33829314e+10, -2.38786585e+11),
    vec2(-4.10625077e+12, 2.56184895e+12),
    vec2(-7.15976159e+12, -2.69900418e+13),
    vec2(4.06838224e+13, 2.3006533e+12),
    vec2(2.55734046e+13, -5.45699701e+12));
const vec2  SKIP_C[SKIPS] = vec2[SKIPS](
    vec2(-7620.481, 158.130958),
    vec2(-22050.3911, 16382.7711),
    vec2(16245.4491, -780939.837),
    vec2(4118759.62, 3871958.79),
    vec2(-39140045.5, 109350688),
    vec2(448152811, 219203290),
    vec2(3.01948519e+09, -865102237),
    vec2(4.76807632e+10, -7.46823363e+09),
    vec2(-1.95041226e+12, -1.45592511e+12),
    vec2(5.94786337e+12, 2.90412377e+13),
    vec2(-2.45018145e+14, -2.81399436e+14),
    vec2(-1.15375517e+16, -3.33212243e+14),
    vec2(-3.7185405e+16, 7.89721816e+16),
    vec2(-4.37963078e+17, 1.08586382e+16),
    vec2(-1.38735123e+18, -6.54381867e+17),
    vec2(5.9622549e+18, -6.53999291e+18),
    vec2(6.49713461e+18, 1.14301004e+19),
    vec2(6.14720959e+18, 6.09171895e+18));

// 3x5 digits, one bit per pixel, top row first.
const int DIGITS[10] = int[10](31599, 9362, 29671, 29391, 23497, 31183, 31215, 29257, 31727, 31695);

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

// Inside the main cardioid or the period-2 disc, which never escape.
bool inBody(vec2 c) {
    vec2  a = c - vec2(0.25, 0.0);
    float q = dot(a, a);
    vec2  b = c + vec2(1.0, 0.0);
    return q * (q + a.x) < 0.25 * c.y * c.y || dot(b, b) < 0.0625;
}

// Colour of the point dc away from the minibrot's centre. step is the change
// in dc per unit of distance on screen, where a unit is 1/720 of the height.
// skip picks the shortcut to start from, or is -1 for none.
vec3 shade(vec2 dc, vec2 step, int maxIter, int skip) {
    if (inBody(NUCLEUS + dc)) return vec3(0.0);

    vec2  dz  = vec2(0.0); // offset from the reference orbit
    vec2  der = vec2(0.0); // change in z per unit on screen, for the distance estimate
    vec2  z   = vec2(0.0);
    float r2  = 0.0;
    int   n   = 0;         // position along the reference orbit
    int   i   = 0;
    if (skip >= 0) {
        vec2 a = SKIP_A[skip], b = SKIP_B[skip], c = SKIP_C[skip];
        dz  = cmul(dc, a + cmul(dc, b + cmul(dc, c)));
        der = cmul(step, a + cmul(dc, 2.0 * b + 3.0 * cmul(dc, c)));
        n   = SKIP_N[skip] % PERIOD;
        i   = SKIP_N[skip];
    }
    for (; i < maxIter; i++) {
        vec2 ref = ORBIT[n];
        z  = ref + dz;
        r2 = dot(z, z);
        if (r2 > BAILOUT * BAILOUT) break;
        der = cmul(2.0 * z, der) + step;

        // Once the point is nearer zero than the reference is, the offset is
        // the larger of the two. Carry on from the start of the orbit, where
        // the reference is zero and the offset is the point itself.
        if (r2 < dot(dz, dz)) {
            dz  = z;
            ref = vec2(0.0);
            n   = 0;
        }
        dz = cmul(2.0 * ref + dz, dz) + dc;
        n  = n + 1 == PERIOD ? 0 : n + 1;
    }

    // Never escaped. Deep inside the set der settles to something small and
    // the point is black; on a filament it blows up and the point is white.
    if (i == maxIter) {
        float d = 1.0 / length(der);
        if (!(d > 0.0)) d = 0.0;
        return vec3(exp(-GLOW * d));
    }

    // Distance to the set in screen units. Overflow in der means the point is on it.
    float r = sqrt(r2);
    float d = r * log(r) / length(der);
    if (!(d > 0.0)) d = 0.0;

    float glow = exp(-GLOW * d);
    float body = 0.35 + 0.65 * min(1.0, pow(d / 40.0, 0.35));
    return mix(palette(0.13 * log(d + 1.0) + 0.55) * body, vec3(1.0), glow);
}

// The picture at a zoom depth, where 0 is the whole set filling the view and 1
// is the minibrot filling it the same way.
vec3 view(float depth) {
    // The point that the map onto the minibrot leaves where it is: the one
    // place that can stay at the centre of the screen across the wrap.
    vec2 centre = cdiv(cmul(SIZE, NUCLEUS), vec2(1.0, 0.0) - SIZE);

    float unit = uResolution.y / 720.0;
    vec2  step = polar(VIEW / 360.0 * exp(depth * log(length(SIZE))), depth * atan(SIZE.y, SIZE.x));
    vec2  p    = (gl_FragCoord.xy - 0.5 * uResolution) / unit;

    // The longest shortcut that holds out to the corners of the screen.
    float radius = length(step) * 360.0 * length(vec2(uResolution.x / uResolution.y, 1.0)) + length(centre);
    int   skip   = SKIPS - 1;
    while (skip >= 0 && radius > SKIP_RADIUS[skip]) skip--;

    float ramp = clamp(depth, 0.0, 1.0);
    ramp *= ramp;
    return shade(centre + cmul(p, step), step, int(mix(ITER_START, ITER_END, ramp * ramp)), skip);
}

// 1 on the lit pixels of uFps, drawn in the top-left corner.
float fpsMask() {
    float cell = floor(uResolution.y / 240.0) + 1.0; // screen pixels per digit pixel
    vec2  g    = floor((vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) - 4.0 * cell) / cell);
    if (g.x < 0.0 || g.y < 0.0 || g.y > 4.0) return 0.0;

    // Three digit slots, each 3 wide with a column of space after it.
    int slot = int(g.x) / 4;
    int col  = int(g.x) % 4;
    if (slot > 2 || col == 3) return 0.0;

    int value = min(int(uFps + 0.5), 999);
    if (value == 0) return 0.0; // nothing measured yet
    int place = slot == 0 ? 100 : slot == 1 ? 10 : 1;
    if (value < place && slot < 2) return 0.0; // no leading zeros
    int digit = (value / place) % 10;
    return float((DIGITS[digit] >> (14 - (int(g.y) * 3 + col))) & 1);
}

void main() {
    // Seconds for one pass from the whole set to the minibrot.
    float cycle = DOUBLING * -log2(length(SIZE));

    // Depth runs from WRAP - 1 up to WRAP, then wraps. It starts at 0.
    float depth = fract(uTime / cycle + 1.0 - WRAP) + WRAP - 1.0;

    // Near the wrap the minibrot at this depth and the whole set one pass
    // back are the same dot; fade between them.
    vec3  col  = view(depth);
    float fade = smoothstep(WRAP - FADE / cycle, WRAP, depth);
    if (fade > 0.0) col = mix(col, view(depth - 1.0), fade);

    fragColor = vec4(mix(col, FPS_COLOUR, fpsMask()), 1.0);
}
