#version 410 core

uniform vec2  uResolution; // framebuffer size in pixels
uniform float uTime;       // seconds since start
uniform vec2  uMouse;      // cursor in pixels, origin bottom-left

out vec4 fragColor;

vec3 palette(float t) {
    return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}

void main() {
    // Centered coordinates, y in [-1, 1], aspect-corrected.
    vec2 uv = (2.0 * gl_FragCoord.xy - uResolution) / uResolution.y;
    vec2 m  = (2.0 * uMouse - uResolution) / uResolution.y;

    vec3 col = vec3(0.0);
    vec2 p = uv;
    for (int i = 0; i < 4; i++) {
        p = fract(p * 1.5) - 0.5;
        float d = length(p) * exp(-length(uv));
        float ring = abs(sin(d * 8.0 + uTime) / 8.0);
        col += palette(length(uv) + float(i) * 0.4 + uTime * 0.2) * pow(0.01 / ring, 1.2);
    }

    // Soft glow that follows the cursor.
    col += 0.15 / (0.1 + 8.0 * dot(uv - m, uv - m));

    fragColor = vec4(col, 1.0);
}
